const fs = require('fs');
const path = require('path');
const axios = require('axios');
const BN = require('bn.js');
const Web3 = require('web3');
const uniq = require('lodash.uniq');
const { toBN, fromWei, toWei } = require('web3-utils');
const {
	wrap,
	toBytes32,
	constants: { CONFIG_FILENAME, PYNTHS_FILENAME, DEPLOYMENT_FILENAME },
} = require('../../..');
const { red, gray, yellow } = require('chalk');

const {
	ensureNetwork,
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
	loadConnections,
} = require('../util');

const DEFAULTS = {
	network: 'kovan',
};

async function extractStakingBalances({ network = DEFAULTS.network, deploymentPath, pynth }) {
	ensureNetwork(network);
	deploymentPath = deploymentPath || getDeploymentPathForNetwork({ network });
	ensureDeploymentPath(deploymentPath);

	// We're just using the ERC20 members `balanceOf` and `Transfer`, so any ERC20 contract will do.
	const { getSource, getTarget, getVersions } = wrap({ network, deploymentPath, fs, path });

	const { abi: periABI } = getSource({ contract: 'PeriFinance' });

	/** *********** Replace Settings Here *********** **/

	// The RPC endpoint that the results will be retrieved from. Preferably this is an archive node.
	const { providerUrl, etherscanUrl } = loadConnections({
		network,
	});

	// The filename the results will be saved to.
	const owedFile = 'owedBalances.csv';

	// The address of the inverse pynth that is about to be purged.
	// Note that this must be the PROXY address, where Transfer events are emitted from.
	const iPynthContract = getTarget({ contract: `Proxy${pynth === 'pUSD' ? 'ERC20pUSD' : pynth}` });

	if (!iPynthContract) {
		throw new Error(`Cannot find pynth contract for pynth: "${pynth}"`);
	}

	const iPynthAddress = iPynthContract.address;
	console.log(gray(`Using Proxy${pynth} address of`), yellow(iPynthAddress));

	// Address of the staking contract, which we will retrieve staked balances from.
	// Note: this only works before it is released
	const lastStakingVersionThatsCurrent = getVersions({ byContract: true })[
		`StakingRewards${pynth}`
	].find(({ status }) => status === 'current');

	const stakingAddress = lastStakingVersionThatsCurrent.address;
	console.log(gray(`Using StakingRewards${pynth} address of`), yellow(stakingAddress));

	const result = await axios.get(etherscanUrl, {
		params: {
			module: 'account',
			action: 'txlist',
			address: stakingAddress,
			apikey: process.env.ETHERSCAN_KEY,
		},
	});

	// The block that the staking contract was deployed, for filtering transfers into it.
	const deploymentBlock = +result.data.result[0].blockNumber;

	console.log(`Loading rewards for pynth ${pynth} on network ${network}`);

	console.log(
		gray(`Staking rewards StakingRewards${pynth} deployed at block`),
		yellow(deploymentBlock)
	);

	const web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));

	const ExchangeRates = new web3.eth.Contract(
		getSource({ contract: 'ExchangeRates' }).abi,
		getTarget({ contract: 'ExchangeRates' }).address
	);

	// The price at which the inverse pynth was frozen, to compute how much users are owed after purging
	const frozenPrice = await ExchangeRates.methods.rateForCurrency(toBytes32(pynth)).call();

	console.log(`${pynth} current price is `, yellow(web3.utils.fromWei(frozenPrice)));

	const isFrozen = await ExchangeRates.methods.rateIsFrozen(toBytes32(pynth)).call();

	if (!isFrozen) {
		throw new Error(`Error: ${pynth} not frozen`);
	}

	const SystemSettings = new web3.eth.Contract(
		getSource({ contract: 'SystemSettings' }).abi,
		getTarget({ contract: 'SystemSettings' }).address
	);

	// The exchange fee incurred when users are purged into pUSD
	const exchangeFee = await SystemSettings.methods.exchangeFeeRate(toBytes32('pUSD')).call();

	console.log(gray(`Exchange fee of pUSD is`), yellow(web3.utils.fromWei(exchangeFee)));

	/** *********** --------------------- *********** **/

	// Fixed point multiplication utilities
	function multiplyDecimal(x, y) {
		const xBN = BN.isBN(x) ? x : toBN(x);
		const yBN = BN.isBN(y) ? y : toBN(y);

		const unit = toBN(toWei('1'));
		return xBN.mul(yBN).div(unit);
	}

	// Retrieves a user's staking balance from the staking contract
	async function getStakingBalance(stakingContract, account) {
		return {
			address: account,
			balance: await stakingContract.methods.balanceOf(account).call(),
		};
	}

	function formatDate(timestamp) {
		const date = new Date(timestamp);
		return `${date.getUTCFullYear()}/${date.getUTCMonth()}/${date.getUTCDate()} ${date.getUTCHours()}:${date.getUTCMinutes()}:${date.getUTCSeconds()} UTC`;
	}

	function logProgress(i, total) {
		const fillChar = '█';
		const progress = i / total;
		const length = 50;
		const filled = Math.floor(length * progress);
		const bar = `|${fillChar.repeat(filled)}${'-'.repeat(length - filled)}|`;
		const progressString = `    ${bar} - ${i} / ${total} (${Math.round(100 * progress)}%)`;

		process.stdout.clearLine();
		process.stdout.cursorTo(0);
		process.stdout.write(progressString);
	}

	// Looks for all transfers into the staking contract
	async function fetchStakedBalances() {
		const iPynth = new web3.eth.Contract(periABI, iPynthAddress);
		const stakingContract = new web3.eth.Contract(periABI, stakingAddress);

		const currentBlock = await web3.eth.getBlockNumber();
		const deploymentBlockDetails = await web3.eth.getBlock(deploymentBlock);

		console.log(`Querying all transfers into the staking contract to find candidate stakers.\n`);
		console.log(`    Staking Contract: ${stakingAddress}`);
		console.log(`    Pynth: ${iPynthAddress}`);
		console.log(
			`    Starting Block: ${deploymentBlock} (${currentBlock -
				deploymentBlock} blocks ago at ${formatDate(deploymentBlockDetails.timestamp * 1000)})\n`
		);

		const transferEvents = await iPynth.getPastEvents('Transfer', {
			filter: {
				to: stakingAddress,
			},
			fromBlock: deploymentBlock - 1,
		});

		const candidates = uniq(transferEvents.map(e => e.returnValues.from));

		const nonzero = [];

		console.log(`${candidates.length} candidate holders found. Querying their balances.\n`);
		let i = 0;

		for (const candidate of candidates) {
			const stakerAndBalance = await getStakingBalance(stakingContract, candidate);
			if (stakerAndBalance.balance.toString() !== '0') {
				nonzero.push(stakerAndBalance);
			}

			i += 1;
			// Log our progress
			logProgress(i, candidates.length);
		}

		console.log(`\n\n${nonzero.length} active stakers found.`);

		return nonzero;
	}

	// Computes the balances owed to each account
	function computeOwedBalances(balances) {
		console.log(`\nComputing owed pUSD balances for accounts using parameters:`);
		console.log(`    Price: ${fromWei(frozenPrice)}`);
		console.log(`    Exchange Fee: ${fromWei(multiplyDecimal(exchangeFee, toWei('100')))}%`);

		const feeMultiplier = toBN(toWei('1')).sub(toBN(exchangeFee));

		const result = balances.map(b => {
			const owed = multiplyDecimal(multiplyDecimal(toBN(b.balance), frozenPrice), feeMultiplier);
			return {
				address: b.address,
				balance: b.balance,
				owed: owed.toString(),
				readableBalance: fromWei(b.balance),
				readableOwed: fromWei(owed),
			};
		});

		const totalStaked = result.reduce((total, curr) => total.add(toBN(curr.balance)), toBN(0));
		const totalOwed = result.reduce((total, curr) => total.add(toBN(curr.owed)), toBN(0));

		console.log(`\n${fromWei(totalStaked)} staked in total.`);
		console.log(`${fromWei(totalOwed)} total pUSD owed.\n`);
		return result;
	}

	function saveOwedBalances(owedPUSDBalances) {
		let csvString = 'Address,Staked Balance,Owed pUSD,Readable Staked Balance,Readable Owed pUSD\n';

		for (const balance of owedPUSDBalances) {
			const line = `${balance.address},${balance.balance},${balance.owed},${balance.readableBalance},${balance.readableOwed}\n`;
			csvString = csvString.concat(line);
		}

		csvString = csvString.concat(`\nPrice,${fromWei(frozenPrice)}\n`);
		csvString = csvString.concat(`Exchange Fee,${fromWei(exchangeFee)}\n`);

		console.log(`Saving results to ${owedFile}...`);
		fs.writeFileSync(owedFile, csvString);
	}

	const nonzeroBalances = await fetchStakedBalances();
	const owedPUSDBalances = computeOwedBalances(nonzeroBalances);

	saveOwedBalances(owedPUSDBalances);
}

module.exports = {
	extractStakingBalances,
	cmd: program =>
		program
			.command('extract-staking-balances')
			.option(
				'-n, --network <value>',
				'The network to run off.',
				x => x.toLowerCase(),
				DEFAULTS.network
			)
			.option(
				'-d, --deployment-path <value>',
				`Path to a folder that has your input configuration file ${CONFIG_FILENAME}, the pynth list ${PYNTHS_FILENAME} and where your ${DEPLOYMENT_FILENAME} files will go`
			)
			.option('-s, --pynth <value>', 'The pynth to extract from')
			.description('Extracts staking reward balances')
			.action(async (...args) => {
				try {
					await extractStakingBalances(...args);
				} catch (err) {
					console.error(red(err));
					console.log(err.stack);
					process.exitCode = 1;
				}
			}),
};
