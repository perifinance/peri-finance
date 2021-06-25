require('dotenv').config();

const Web3 = require('web3');
const path = require('path');
const schedule = require('node-schedule');
const cron = require('cron-validator');
const axios = require('axios');

const {
	ensureNetwork,
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
	loadAndCheckRequiredSources,
	loadConnections,
	performTransactionalStep,
} = require('../util');

const {
	constants: { BUILD_FOLDER, CONFIG_FILENAME, PYNTHS_FILENAME, DEPLOYMENT_FILENAME },
} = require('../../../.');

const { getVersions, getUsers, toBytes32 } = require('../../../');

const DEFAULTS = {
	network: 'kovan',
	buildPath: path.join(__dirname, '..', '..', '..', BUILD_FOLDER),
	methodCallGasLimit: 250e3, // 250k
	gasPrice: '1',
	cronScheduleFormat: `0 0 0/8 ? * *`,
	methodArgs: [],
	feedUrls: [],
};

function getExistingContract({ network, deployment, contract, web3 }) {
	let address;
	if (network === 'local') {
		address = deployment.targets[contract].address;
	} else {
		const contractVersion = getVersions({
			network,
			byContract: true,
		})[contract];
		const lastEntry = contractVersion.slice(-1)[0];
		address = lastEntry.address;
	}

	const { source } = deployment.targets[contract];
	const { abi } = deployment.sources[source];
	return new web3.eth.Contract(abi, address);
}

const scheduler = async ({
	network = DEFAULTS.network,
	methodCallGasLimit = DEFAULTS.methodCallGasLimit,
	gasPrice = DEFAULTS.gasPrice,
	deploymentPath,
	scheduler,
	schedulerMethod,
	privateKey,
	providerUrl,
	cronScheduleFormat = DEFAULTS.cronScheduleFormat,
}) => {
	if (!schedulerMethod) {
		throw new Error('must specify contract method to run');
	}
	if (!cronScheduleFormat || !cron.isValidCron(cronScheduleFormat, { seconds: true })) {
		throw new Error('must specify scheduler time or correct scheduler time');
	}
	ensureNetwork(network);
	deploymentPath = deploymentPath || getDeploymentPathForNetwork({ network });
	ensureDeploymentPath(deploymentPath);

	const { deployment } = loadAndCheckRequiredSources({
		deploymentPath,
		network,
	});

	const {
		providerUrl: envProviderUrl,
		privateKey: envPrivateKey,
		etherscanLinkPrefix,
	} = loadConnections({
		network,
	});

	if (!providerUrl) {
		if (!envProviderUrl) {
			throw new Error('Missing .env key of PROVIDER_URL. Please add and retry.');
		}

		providerUrl = envProviderUrl;
	}

	// if not specified, or in a local network, override the private key passed as a CLI option, with the one specified in .env
	if (network !== 'local' && !privateKey) {
		privateKey = envPrivateKey;
	}

	const web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));

	if (!privateKey && network === 'local') {
		web3.eth.defaultAccount = getUsers({ network, user: 'owner' }).address; // protocolDAO
	} else {
		web3.eth.accounts.wallet.add(privateKey);
		web3.eth.defaultAccount = web3.eth.accounts.wallet[0].address;
	}
	const account = web3.eth.defaultAccount;

	const runStep = async opts =>
		performTransactionalStep({
			gasLimit: methodCallGasLimit, // allow overriding of gasLimit
			...opts,
			account,
			gasPrice,
			etherscanLinkPrefix,
		});

	const schedulerContract = getExistingContract({ network, deployment, contract: scheduler, web3 });

	console.log('Starting Schedule');
	schedule.scheduleJob(cronScheduleFormat, async () => {
		console.log(`\n## scheduler name : ${scheduler}`);
		console.log(`\n## scheduler method : ${schedulerMethod}`);
		console.log(`Running Schedule at ${new Date().toLocaleString()}`);

		let cnt = 0;
		let success = false;
		while (!success && cnt < 100) {
			try {
				cnt++;

				if (DEFAULTS.feedUrls.length > 0 && DEFAULTS.methodArgs.length > 0) {
					const feedPriceArr = [];

					for (const feedUrl of DEFAULTS.feedUrls) {
						const price = await requestPriceFeed(feedUrl);
						feedPriceArr.push(price);
					}

					const feedKeyArr = DEFAULTS.methodArgs.map(toBytes32);

					await runStep({
						contract: scheduler,
						target: schedulerContract,
						write: schedulerMethod,
						writeArg: [feedKeyArr, feedPriceArr, new Date().getTime() / 1000],
					});
				} else if (DEFAULTS.methodArgs.length > 0) {
					await runStep({
						contract: scheduler,
						target: schedulerContract,
						write: schedulerMethod,
						writeArg: DEFAULTS.methodArgs,
					});
				} else {
					await runStep({
						contract: scheduler,
						target: schedulerContract,
						write: schedulerMethod,
					});
				}

				success = true;
			} catch (e) {
				console.log(e);
				await sleep(3000);
			}
		}
	});
};

function requestPriceFeed(url) {
	return axios
		.get(url)
		.then(({ data }) => {
			const lastPrice = Web3.utils.toWei(data.last);
			return lastPrice;
		})
		.catch(e => {
			console.log(e);
		});
}

function sleep(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

module.exports = {
	scheduler,
	cmd: program =>
		program
			.command('scheduler')
			.description('add contract call scheduling')
			.option('-n, --network <value>', `The network which scheduler will be called`)
			.option(
				'-d, --deployment-path <value>',
				`Path to a folder that has your input configuration file ${CONFIG_FILENAME}, the pynth list ${PYNTHS_FILENAME} and where your ${DEPLOYMENT_FILENAME} files will go`
			)
			.option(
				'-m, --method-call-gas-limit <value>',
				'Method call gas limit',
				parseFloat,
				DEFAULTS.methodCallGasLimit
			)
			.option('-g, --gas-price <value>', 'Gas price in GWEI', DEFAULTS.gasPrice)
			.option('-s, --scheduler <value>', `The name of the contract scheduler`)
			.option('-sm, --scheduler-method <value>', `Method to call of the scheduler`)
			.option(
				'-sma, --scheduler-method-arguments <value>',
				`Method Arguments`,
				x => DEFAULTS.methodArgs.push(x),
				DEFAULTS.methodArgs
			)
			.option('-csf, --cron-schedule-format <value>', `cron schedule format for scheduler`)
			.option(
				'-fu, --feed-urls <value>',
				`url to request price feeds`,
				x => DEFAULTS.feedUrls.push(x),
				DEFAULTS.feedUrls
			)
			.option(
				'-v, --private-key [value]',
				'The private key to deploy with (only works in local mode, otherwise set in .env).'
			)
			.action(scheduler),
};
