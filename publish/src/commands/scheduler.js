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
	getVersions,
	getUsers,
	toBytes32,
} = require('../../../');

const DEFAULTS = {
	network: 'kovan',
	buildPath: path.join(__dirname, '..', '..', '..', BUILD_FOLDER),
	methodCallGasLimit: 250e3, // 250k
	gasPrice: '1',
	cronScheduleFormat: `0 0 0/8 ? * *`,
	methodArgs: [],
	feedUrls: [],
	tryCnt: 10,
	priority: 'safeLow',
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

function estimatePolygonGasPice(network, priority) {
	const gasStationUrl = `https://gasstation-${network === 'polygon' ? 'mainnet' : network}.matic.${
		network === 'polygon' ? 'network' : 'today'
	}`;

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
	tryCnt = DEFAULTS.tryCnt,
	publiclyCallable,
	priority = DEFAULTS.priority,
}) => {
	if (!schedulerMethod) {
		throw new Error('must specify contract method to run');
	}
	if (
		!cronScheduleFormat ||
		!cron.isValidCron(cronScheduleFormat, { seconds: true, allowBlankDay: true })
	) {
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

	console.log('Starting Schedule');
	schedule.scheduleJob(cronScheduleFormat, async () => {
		console.log(`\n## scheduler name : ${scheduler}`);
		console.log(`\n## scheduler method : ${schedulerMethod}`);
		console.log(`Running Schedule at ${new Date().toLocaleString()}`);

		let cnt = 0;
		let success = false;
		while (!success && cnt < tryCnt) {
			if (['polygon', 'mumbai'].includes(network)) {
				gasPrice = await estimatePolygonGasPice(network, priority);
				console.log(`using gas price : ${gasPrice}`);
				if (!gasPrice) throw new Error('gas price is undefined');
			}

			const runStep = async opts =>
				performTransactionalStep({
					gasLimit: methodCallGasLimit, // allow overriding of gasLimit
					...opts,
					account,
					gasPrice,
					etherscanLinkPrefix,
					publiclyCallable,
				});

			const schedulerContract = getExistingContract({
				network,
				deployment,
				contract: scheduler,
				web3,
			});

			try {
				cnt++;
				const now = (new Date().getTime() / 1000).toFixed(0); // convert to epoch time

				if (DEFAULTS.feedUrls.length > 0 && DEFAULTS.methodArgs.length > 0) {
					const feedPriceArr = [];

					for (const feedUrl of DEFAULTS.feedUrls) {
						const price = await requestPriceFeed(feedUrl);
						feedPriceArr.push(price);
					}

					const feedKeyArr = DEFAULTS.methodArgs.map(toBytes32);
					if (feedPriceArr.length !== feedKeyArr.length) {
						throw new Error('must match the length of price and key');
					}

					feedKeyArr.forEach(async (feedKey, index) => {
						await runStep({
							contract: scheduler,
							target: schedulerContract,
							read: 'getRateAndUpdatedTime',
							readArg: feedKey,
							expected: input => {
								const rate = input[0];
								const time = input[1];
								if (rate === 0 || time === 0) return false;
								// check if rate has changed or time has passed 5 mins
								return rate === feedPriceArr[index] || time > now - 300;
							},
							write: schedulerMethod,
							writeArg: [[feedKey], [feedPriceArr[index]], now],
						});
					});
				} else if (DEFAULTS.methodArgs.length > 0) {
					const methodArgs = DEFAULTS.methodArgs.map(x => (isNaN(x) ? x : Web3.utils.toWei(x)));
					console.log(`adding arguments : ${methodArgs}`);

					await runStep({
						contract: scheduler,
						target: schedulerContract,
						write: schedulerMethod,
						writeArg: methodArgs,
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
			.option(
				'-tc, --try-cnt [value]',
				'try count if scheduler failed to call contracts',
				DEFAULTS.tryCnt
			)
			.option(
				'-pc, --publicly-callable',
				'Add this if scheduler method has to be called from other accounts',
				false
			)
			.option(
				'-p, --priority <value>',
				'Only used for polygon networks, available options : ["safeLow", "standard", "fast", "fastest"]',
				x => x.toLowerCase(),
				DEFAULTS.priority
			)
			.action(scheduler),
};
