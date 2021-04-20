'use strict';

const { gray, green, yellow, red, cyan } = require('chalk');
const Web3 = require('web3');
const w3utils = require('web3-utils');
const axios = require('axios');

const {
	toBytes32,
	constants: { CONFIG_FILENAME, DEPLOYMENT_FILENAME },
} = require('../../..');

const {
	ensureNetwork,
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
	loadAndCheckRequiredSources,
	loadConnections,
	confirmAction,
	performTransactionalStep,
} = require('../util');

const DEFAULTS = {
	network: 'kovan',
	gasLimit: 3e6,
	gasPrice: '1',
	batchSize: 15,
};

const purgePynths = async ({
	network = DEFAULTS.network,
	deploymentPath,
	gasPrice = DEFAULTS.gasPrice,
	gasLimit = DEFAULTS.gasLimit,
	pynthsToPurge = [],
	dryRun = false,
	yes,
	privateKey,
	addresses = [],
	batchSize = DEFAULTS.batchSize,
	proxyAddress,
}) => {
	ensureNetwork(network);
	deploymentPath = deploymentPath || getDeploymentPathForNetwork({ network });
	ensureDeploymentPath(deploymentPath);

	const { pynths, deployment } = loadAndCheckRequiredSources({
		deploymentPath,
		network,
	});

	if (pynthsToPurge.length < 1) {
		console.log(gray('No pynths provided. Please use --pynths-to-remove option'));
		return;
	}

	// sanity-check the pynth list
	for (const pynth of pynthsToPurge) {
		if (pynths.filter(({ name }) => name === pynth).length < 1) {
			console.error(red(`Pynth ${pynth} not found!`));
			process.exitCode = 1;
			return;
		} else if (['pUSD'].indexOf(pynth) >= 0) {
			console.error(red(`Pynth ${pynth} cannot be purged`));
			process.exitCode = 1;
			return;
		}
	}

	if (pynthsToPurge.length > 1 && proxyAddress) {
		console.error(red(`Cannot provide a proxy address with multiple pynths`));
		process.exitCode = 1;
		return;
	}

	const { providerUrl, privateKey: envPrivateKey, etherscanLinkPrefix } = loadConnections({
		network,
	});

	// allow local deployments to use the private key passed as a CLI option
	if (network !== 'local' || !privateKey) {
		privateKey = envPrivateKey;
	}

	const web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));
	web3.eth.accounts.wallet.add(privateKey);
	const account = web3.eth.accounts.wallet[0].address;
	console.log(gray(`Using account with public key ${account}`));
	console.log(gray(`Using gas of ${gasPrice} GWEI with a max of ${gasLimit}`));

	console.log(gray('Dry-run:'), dryRun ? green('yes') : yellow('no'));

	if (!yes) {
		try {
			await confirmAction(
				cyan(
					`${yellow(
						'⚠ WARNING'
					)}: This action will purge the following pynths from the PeriFinance contract on ${network}:\n- ${pynthsToPurge.join(
						'\n- '
					)}`
				) + '\nDo you want to continue? (y/n) '
			);
		} catch (err) {
			console.log(gray('Operation cancelled'));
			return;
		}
	}

	const { address: periFinanceAddress, source } = deployment.targets['PeriFinance'];
	const { abi: periFinanceABI } = deployment.sources[source];
	const PeriFinance = new web3.eth.Contract(periFinanceABI, periFinanceAddress);

	let totalBatches = 0;
	for (const currencyKey of pynthsToPurge) {
		const { address: pynthAddress, source: pynthSource } = deployment.targets[
			`Pynth${currencyKey}`
		];

		const { abi: pynthABI } = deployment.sources[pynthSource];
		const Pynth = new web3.eth.Contract(pynthABI, pynthAddress);
		proxyAddress = proxyAddress || deployment.targets[`Proxy${currencyKey}`].address;

		console.log(
			gray(
				'For',
				currencyKey,
				'using source of',
				pynthSource,
				'at address',
				pynthAddress,
				'proxy',
				proxyAddress
			)
		);

		const currentPynthInPERI = await PeriFinance.methods.pynths(toBytes32(currencyKey)).call();

		if (pynthAddress !== currentPynthInPERI) {
			console.error(
				red(
					`Pynth address in PeriFinance for ${currencyKey} is different from what's deployed in PeriFinance to the local ${DEPLOYMENT_FILENAME} of ${network} \ndeployed: ${yellow(
						currentPynthInPERI
					)}\nlocal:    ${yellow(pynthAddress)}`
				)
			);
			process.exitCode = 1;
			return;
		}

		// step 1. fetch all holders via ethplorer api
		if (network === 'mainnet') {
			const topTokenHoldersUrl = `http://api.ethplorer.io/getTopTokenHolders/${proxyAddress}`;
			const response = await axios.get(topTokenHoldersUrl, {
				params: {
					apiKey: process.env.ETHPLORER_API_KEY || 'freekey',
					limit: 1000,
				},
			});

			const topTokenHolders = response.data.holders.map(({ address }) => address);
			console.log(gray(`Found ${topTokenHolders.length} possible holders of ${currencyKey}`));
			// Filter out any 0 holder
			const supplyPerEntry = await Promise.all(
				topTokenHolders.map(entry => Pynth.methods.balanceOf(entry).call())
			);
			addresses = topTokenHolders.filter((e, i) => supplyPerEntry[i] !== '0');
			console.log(gray(`Filtered to ${addresses.length} with supply`));
		}

		const totalSupplyBefore = w3utils.fromWei(await Pynth.methods.totalSupply().call());

		if (Number(totalSupplyBefore) === 0) {
			console.log(gray('Total supply is 0, exiting.'));
			continue;
		} else {
			console.log(gray('Total supply before purge is:', totalSupplyBefore));
		}

		// Split the addresses into batch size
		// step 2. start the purge
		for (let batch = 0; batch * batchSize < addresses.length; batch++) {
			const start = batch * batchSize;
			const end = Math.min((batch + 1) * batchSize, addresses.length);
			const entries = addresses.slice(start, end);

			totalBatches++;

			console.log(`batch: ${batch} of addresses with ${entries.length} entries`);

			if (dryRun) {
				console.log(green('Would attempt to purge:', entries));
			} else {
				await performTransactionalStep({
					account,
					contract: `Pynth${currencyKey}`,
					target: Pynth,
					write: 'purge',
					writeArg: [entries], // explicitly pass array of args so array not splat as params
					gasLimit,
					gasPrice,
					etherscanLinkPrefix,
					encodeABI: network === 'mainnet',
				});
			}
		}

		// step 3. confirmation
		const totalSupply = w3utils.fromWei(await Pynth.methods.totalSupply().call());
		if (Number(totalSupply) > 0) {
			console.log(
				yellow(
					`⚠⚠⚠ WARNING: totalSupply is not 0 after purge of ${currencyKey}. It is ${totalSupply}. ` +
						`Were there 100 or 1000 holders noted above? If so then we have likely hit the tokenHolder ` +
						`API limit; another purge is required for this pynth.`
				)
			);
		}
	}
	console.log(`Total number of batches: ${totalBatches}`);
};

module.exports = {
	purgePynths,
	cmd: program =>
		program
			.command('purge-pynths')
			.description('Purge a number of pynths from the system')
			.option(
				'-a, --addresses <value>',
				'The list of holder addresses (use in testnets when Ethplorer API does not return holders)',
				(val, memo) => {
					memo.push(val);
					return memo;
				},
				[]
			)
			.option(
				'-d, --deployment-path <value>',
				`Path to a folder that has your input configuration file ${CONFIG_FILENAME} and where your ${DEPLOYMENT_FILENAME} files will go`
			)
			.option('-g, --gas-price <value>', 'Gas price in GWEI', DEFAULTS.gasPrice)
			.option('-l, --gas-limit <value>', 'Gas limit', DEFAULTS.gasLimit)
			.option(
				'-n, --network [value]',
				'The network to run off.',
				x => x.toLowerCase(),
				DEFAULTS.network
			)
			.option('-r, --dry-run', 'Dry run - no changes transacted')
			.option(
				'-v, --private-key [value]',
				'The private key to transact with (only works in local mode, otherwise set in .env).'
			)
			.option(
				'-bs, --batch-size [value]',
				'Batch size for the addresses to be split into',
				DEFAULTS.batchSize
			)
			.option(
				'-p, --proxy-address <value>',
				'Override the proxy address for the token (only works with a single pynth given)'
			)
			.option(
				'-s, --pynths-to-purge <value>',
				'The list of pynths to purge',
				(val, memo) => {
					memo.push(val);
					return memo;
				},
				[]
			)
			.action(purgePynths),
};
