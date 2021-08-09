'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { gray, cyan, yellow, redBright, green } = require('chalk');
const { table } = require('table');
const w3utils = require('web3-utils');
const axios = require('axios');

const {
	constants: {
		CONFIG_FILENAME,
		PARAMS_FILENAME,
		DEPLOYMENT_FILENAME,
		OWNER_ACTIONS_FILENAME,
		PYNTHS_FILENAME,
		STAKING_REWARDS_FILENAME,
		SHORTING_REWARDS_FILENAME,
		VERSIONS_FILENAME,
		FEEDS_FILENAME,
	},
	wrap,
} = require('../..');

const {
	getPathToNetwork,
	getPynths,
	getStakingRewards,
	getVersions,
	getFeeds,
	getShortingRewards,
} = wrap({
	path,
	fs,
});

const { networks } = require('../..');
const stringify = input => JSON.stringify(input, null, '\t') + '\n';

const ensureNetwork = network => {
	if (!networks.includes(network)) {
		throw Error(
			`Invalid network name of "${network}" supplied. Must be one of ${networks.join(', ')}.`
		);
	}
};

const getDeploymentPathForNetwork = ({ network, useOvm }) => {
	console.log(gray('Loading default deployment for network'));
	return getPathToNetwork({ network, useOvm });
};

const ensureDeploymentPath = deploymentPath => {
	if (!fs.existsSync(deploymentPath)) {
		throw Error(
			`Invalid deployment path. Please provide a folder with a compatible ${CONFIG_FILENAME}`
		);
	}
};

// Load up all contracts in the flagged source, get their deployed addresses (if any) and compiled sources
const loadAndCheckRequiredSources = ({ deploymentPath, network }) => {
	console.log(gray(`Loading the list of pynths for ${network.toUpperCase()}...`));
	const pynthsFile = path.join(deploymentPath, PYNTHS_FILENAME);
	const pynths = getPynths({ network, deploymentPath });

	console.log(gray(`Loading the list of staking rewards to deploy on ${network.toUpperCase()}...`));
	const stakingRewardsFile = path.join(deploymentPath, STAKING_REWARDS_FILENAME);
	const stakingRewards = getStakingRewards({ network, deploymentPath });

	console.log(
		gray(`Loading the list of shorting rewards to deploy on ${network.toUpperCase()}...`)
	);
	const shortingRewardsFile = path.join(deploymentPath, SHORTING_REWARDS_FILENAME);
	const shortingRewards = getShortingRewards({ network, deploymentPath });

	console.log(gray(`Loading the list of contracts to deploy on ${network.toUpperCase()}...`));
	const configFile = path.join(deploymentPath, CONFIG_FILENAME);
	const config = JSON.parse(fs.readFileSync(configFile));

	console.log(gray(`Loading the list of deployment parameters on ${network.toUpperCase()}...`));
	const paramsFile = path.join(deploymentPath, PARAMS_FILENAME);
	const params = JSON.parse(fs.readFileSync(paramsFile));

	const versionsFile = path.join(deploymentPath, VERSIONS_FILENAME);
	const versions = network !== 'local' ? getVersions({ network, deploymentPath }) : {};

	const feedsFile = path.join(deploymentPath, FEEDS_FILENAME);
	const feeds = getFeeds({ network, deploymentPath });

	console.log(
		gray(`Loading the list of contracts already deployed for ${network.toUpperCase()}...`)
	);
	const deploymentFile = path.join(deploymentPath, DEPLOYMENT_FILENAME);
	if (!fs.existsSync(deploymentFile)) {
		fs.writeFileSync(deploymentFile, stringify({ targets: {}, sources: {} }));
	}
	const deployment = JSON.parse(fs.readFileSync(deploymentFile));

	const ownerActionsFile = path.join(deploymentPath, OWNER_ACTIONS_FILENAME);
	if (!fs.existsSync(ownerActionsFile)) {
		fs.writeFileSync(ownerActionsFile, stringify({}));
	}
	const ownerActions = JSON.parse(fs.readFileSync(ownerActionsFile));

	return {
		config,
		params,
		configFile,
		pynths,
		pynthsFile,
		stakingRewards,
		stakingRewardsFile,
		deployment,
		deploymentFile,
		ownerActions,
		ownerActionsFile,
		versions,
		versionsFile,
		feeds,
		feedsFile,
		shortingRewards,
		shortingRewardsFile,
	};
};

const getEtherscanLinkPrefix = network => {
	if (['polygon', 'mumbai'].includes(network)) {
		return `https://${network !== 'polygon' ? network + '.' : ''}polygonscan.com`;
	}
	if (['bsc', 'bsctest'].includes(network)) {
		return `https://${network !== 'bsc' ? 'testnet.' : ''}bscscan.com`;
	}
	return `https://${network !== 'mainnet' ? network + '.' : ''}etherscan.io`;
};

const loadConnections = ({ network, useFork }) => {
	// Note: If using a fork, providerUrl will need to be 'localhost', even if the target network is not 'local'.
	// This is because the fork command is assumed to be running at 'localhost:8545'.
	let providerUrl;
	if (network === 'local' || useFork) {
		providerUrl = 'http://127.0.0.1:8545';
	} else {
		if (network === 'mainnet' && process.env.PROVIDER_URL_MAINNET) {
			providerUrl = process.env.PROVIDER_URL_MAINNET;
		} else if (network === 'polygon') {
			providerUrl = process.env.PROVIDER_URL_POLYGON;
		} else if (network === 'mumbai') {
			providerUrl = process.env.PROVIDER_URL_MUMBAI;
		} else if (network === 'bsc') {
			providerUrl = process.env.PROVIDER_URL_BSC;
		} else if (network === 'bsctest') {
			providerUrl = process.env.PROVIDER_URL_BSCTEST;
		} else {
			providerUrl = process.env.PROVIDER_URL.replace('network', network);
		}
	}

	const privateKey = ['mainnet', 'polygon', 'bsc'].includes(network)
		? process.env.DEPLOY_PRIVATE_KEY
		: process.env.TESTNET_DEPLOY_PRIVATE_KEY;

	const etherscanUrl =
		network === 'mainnet'
			? 'https://api.etherscan.io/api'
			: ['kovan', 'goerli', 'robsten', 'rinkeby'].includes(network)
			? `https://api-${network}.etherscan.io/api`
			: ['bsc', 'bsctest'].includes(network)
			? `https://api${network === 'bsc' ? '' : '-testnet'}.bscscan.com/api`
			: ['polygon', 'mumbai'].includes(network)
			? `https://api${network === 'polygon' ? '' : '-testnet'}.polygonscan.com/api`
			: '';

	const etherscanLinkPrefix = getEtherscanLinkPrefix(network);

	const rolePrivateKeys = {
		oracle: process.env.ORACLE_PRIVATE_KEY,
		debtManager: process.env.DEBT_MANAGER_PRIVATE_KEY,
		feePeriodManager: process.env.FEE_PERIOD_MANAGER_PRIVATE_KEY,
		minterManager: process.env.MINTER_MANAGER_PRIVATE_KEY,
	};

	return { providerUrl, privateKey, etherscanUrl, etherscanLinkPrefix, rolePrivateKeys };
};

const confirmAction = prompt =>
	new Promise((resolve, reject) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

		rl.question(prompt, answer => {
			if (/y|Y/.test(answer)) resolve();
			else reject(Error('Not confirmed'));
			rl.close();
		});
	});

const appendOwnerActionGenerator = ({ ownerActions, ownerActionsFile, etherscanLinkPrefix }) => ({
	key,
	action,
	target,
	data,
}) => {
	ownerActions[key] = {
		target,
		action,
		complete: false,
		link: `${etherscanLinkPrefix}/address/${target}#writeContract`,
		data,
	};
	fs.writeFileSync(ownerActionsFile, stringify(ownerActions));
	console.log(cyan(`Cannot invoke ${key} as not owner. Appended to actions.`));
};

let _dryRunCounter = 0;
/**
 * Run a single transaction step, first checking to see if the value needs
 * changing at all, and then whether or not its the owner running it.
 *
 * @returns transaction hash if successful, true if user completed, or falsy otherwise
 */
const performTransactionalStep = async ({
	account,
	contract,
	target,
	read,
	readArg, // none, 1 or an array of args, array will be spread into params
	expected,
	write,
	writeArg, // none, 1 or an array of args, array will be spread into params
	gasLimit,
	gasPrice,
	etherscanLinkPrefix,
	ownerActions,
	ownerActionsFile,
	dryRun,
	encodeABI,
	nonceManager,
	publiclyCallable,
}) => {
	const argumentsForWriteFunction = [].concat(writeArg).filter(entry => entry !== undefined); // reduce to array of args
	const action = `${contract}.${write}(${argumentsForWriteFunction.map(arg =>
		arg.length === 66 ? w3utils.hexToAscii(arg) : arg
	)})`;

	// check to see if action required
	console.log(yellow(`Attempting action: ${action}`));

	if (read) {
		// web3 counts provided arguments - even undefined ones - and they must match the expected args, hence the below
		const argumentsForReadFunction = [].concat(readArg).filter(entry => entry !== undefined); // reduce to array of args
		const response = await target.methods[read](...argumentsForReadFunction).call();

		if (expected(response)) {
			console.log(gray(`Nothing required for this action.`));
			return { noop: true };
		}
	}
	// otherwise check the owner
	const owner = await target.methods.owner().call();
	if (owner === account || publiclyCallable) {
		// perform action
		let hash;
		let gasUsed = 0;
		if (dryRun) {
			_dryRunCounter++;
			hash = '0x' + _dryRunCounter.toString().padStart(64, '0');
		} else {
			const params = {
				from: account,
				gas: Number(gasLimit),
				gasPrice: w3utils.toWei(gasPrice.toString(), 'gwei'),
			};

			if (nonceManager) {
				params.nonce = await nonceManager.getNonce();
			}

			const txn = await target.methods[write](...argumentsForWriteFunction).send(params);

			hash = txn.transactionHash;
			gasUsed = txn.gasUsed;

			if (nonceManager) {
				nonceManager.incrementNonce();
			}
		}

		console.log(
			green(
				`${
					dryRun ? '[DRY RUN] ' : ''
				}Successfully completed ${action} in hash: ${hash}. Gas used: ${(gasUsed / 1e6).toFixed(
					2
				)}m `
			)
		);

		return { mined: true, hash };
	} else {
		console.log(gray(`  > Account ${account} is not owner ${owner}`));
	}

	let data;
	if (ownerActions && ownerActionsFile) {
		// append to owner actions if supplied
		const appendOwnerAction = appendOwnerActionGenerator({
			ownerActions,
			ownerActionsFile,
			etherscanLinkPrefix,
		});

		data = target.methods[write](...argumentsForWriteFunction).encodeABI();

		const ownerAction = {
			key: action,
			target: target.options.address,
			action: `${write}(${argumentsForWriteFunction})`,
			data: data,
		};

		if (dryRun) {
			console.log(
				gray(`[DRY RUN] Would append owner action of the following:\n${stringify(ownerAction)}`)
			);
		} else {
			appendOwnerAction(ownerAction);
		}
		return { pending: true };
	} else {
		// otherwise wait for owner in real time
		try {
			data = target.methods[write](...argumentsForWriteFunction).encodeABI();
			if (encodeABI) {
				console.log(green(`Tx payload for target address ${target.options.address} - ${data}`));
				return { pending: true };
			}

			await confirmAction(
				redBright(
					`Confirm: Invoke ${write}(${argumentsForWriteFunction}) via https://gnosis-safe.io/app/#/safes/${owner}/transactions` +
						`to recipient ${target.options.address}` +
						`with data: ${data}`
				) + '\nPlease enter Y when the transaction has been mined and not earlier. '
			);

			return { pending: true };
		} catch (err) {
			console.log(gray('Cancelled'));
			return {};
		}
	}
};

const parameterNotice = props => {
	console.log(gray('-'.repeat(50)));
	console.log('Please check the following parameters are correct:');
	console.log(gray('-'.repeat(50)));

	Object.entries(props).forEach(([key, val]) => {
		console.log(gray(key) + ' '.repeat(40 - key.length) + redBright(val));
	});

	console.log(gray('-'.repeat(50)));
};

function reportDeployedContracts({ deployer }) {
	console.log(
		green(`\nSuccessfully deployed ${deployer.newContractsDeployed.length} contracts!\n`)
	);

	const tableData = deployer.newContractsDeployed.map(({ name, address }) => [
		name,
		address,
		deployer.deployment.targets[name].link,
	]);
	console.log();
	if (tableData.length) {
		console.log(gray(`All contracts deployed on "${deployer.network}" network:`));
		console.log(table(tableData));
	} else {
		console.log(gray('Note: No new contracts deployed.'));
	}
}

function requestPriceFeedFromGateIO(currencyKey) {
	const feedUrl = `https://data.gateapi.io/api2/1/ticker/${currencyKey}_USDT`;

	return axios
		.get(feedUrl)
		.then(({ data }) => {
			const price = w3utils.toWei(data.last);
			return { price, currencyKey };
		})
		.catch(e => {
			console.log(e);
		});
}

function estimateEtherGasPice(network, priority) {
	const gasStationUrl = `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${process.env.ETHERSCAN_KEY}`;
	console.log(`requesting gas price for ${network} : ${gasStationUrl}`);

	return axios
		.get(gasStationUrl)
		.then(({ data }) => {
			const { SafeGasPrice, ProposeGasPrice, FastGasPrice } = data.result;

			switch (priority) {
				case 'fast':
					return FastGasPrice;
				case 'standard':
					return ProposeGasPrice;
				default:
					return SafeGasPrice;
			}
		})
		.catch(e => console.log(e));
}

function estimatePolygonGasPice(network, priority) {
	const gasStationUrl = `https://gasstation-${network === 'polygon' ? 'mainnet' : network}.matic.${
		network === 'polygon' ? 'network' : 'today'
	}`;
	console.log(`requesting gas price for ${network} : ${gasStationUrl}`);

	return axios
		.get(gasStationUrl)
		.then(({ data }) => {
			const { safeLow, standard, fast, fastest } = data;

			switch (priority) {
				case 'fastest':
					return fastest;
				case 'fast':
					return fast;
				case 'standard':
					return standard;
				default:
					return safeLow;
			}
		})
		.catch(e => console.log(e));
}

function estimateBSCGasPice(network, priority) {
	const gasStationUrl = `https://bscgas.info/gas`;
	console.log(`requesting gas price for ${network} : ${gasStationUrl}`);

	return axios
		.get(gasStationUrl)
		.then(({ data }) => {
			const { slow, standard, fast, instant } = data;

			switch (priority) {
				case 'fastest':
					return instant;
				case 'fast':
					return fast;
				case 'standard':
					return standard;
				default:
					return slow;
			}
		})
		.catch(e => console.log(e));
}

async function checkGasPrice(network, priority) {
	let gasPrice;

	if (['polygon', 'mumbai'].includes(network)) {
		gasPrice = await estimatePolygonGasPice(network, priority);
	} else if (['mainnet', 'kovan', 'goerli', 'robsten', 'rinkeby'].includes(network)) {
		gasPrice = await estimateEtherGasPice(priority);
	} else if (['bsc', 'bsctest'].includes(network)) {
		gasPrice = await estimateBSCGasPice(network, priority);
	}

	console.log(`using gas price : ${gasPrice}`);
	if (!gasPrice) throw new Error('gas price is undefined');

	return gasPrice;
}

function sleep(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

module.exports = {
	ensureNetwork,
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
	loadAndCheckRequiredSources,
	getEtherscanLinkPrefix,
	loadConnections,
	confirmAction,
	appendOwnerActionGenerator,
	stringify,
	performTransactionalStep,
	parameterNotice,
	reportDeployedContracts,
	requestPriceFeedFromGateIO,
	checkGasPrice,
	sleep,
};
