require('dotenv').config();

const Web3 = require('web3');
const schedule = require('node-schedule');
const cron = require('cron-validator');

const path = require('path');
const fs = require('fs');

const {
	ensureNetwork,
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
	loadConnections,
	performTransactionalStep,
	requestPriceFeedFromGateIO,
	checkGasPrice,
	sleep,
} = require('../util');

const { toBN, fromWei, toWei } = require('web3-utils');
const { multiplyDecimal, divideDecimal } = require('../../../test/utils')();

const {
	constants: { BUILD_FOLDER, CONFIG_FILENAME, PYNTHS_FILENAME, DEPLOYMENT_FILENAME },
	wrap,
	toBytes32,
	FEE_PERIOD_DURATION,
} = require('../../../');

const { getSource, getTarget, getUsers } = wrap({
	fs,
	path,
});

const DEFAULTS = {
	network: 'kovan',
	buildPath: path.join(__dirname, '..', '..', '..', BUILD_FOLDER),
	methodCallGasLimit: 100e4, // 1000k
	gasPrice: '1',
	cronScheduleFormat: `0 0 0/8 ? * *`,
	tryCnt: 10,
	feedArgs: [],
};

const getConnectionsByNetwork = ({ network, providerUrl, privateKey }) => {
	let owner, oracle, debtManager, feePeriodManager, minterManager;
	const {
		providerUrl: envProviderUrl,
		privateKey: envPrivateKey,
		etherscanLinkPrefix,
		rolePrivateKeys,
	} = loadConnections({
		network,
	});

	if (!providerUrl) {
		if (!envProviderUrl) {
			throw new Error('Missing .env key of PROVIDER_URL. Please add and retry.');
		}

		providerUrl = envProviderUrl;
	}

	const web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));

	// if not specified, or in a local network, override the private key passed as a CLI option, with the one specified in .env
	if (network !== 'local' && !privateKey) {
		privateKey = envPrivateKey;
	}

	if (!privateKey && network === 'local') {
		web3.eth.defaultAccount = getUsers({ network, user: 'owner' }).address; // protocolDAO
	} else {
		web3.eth.accounts.wallet.add(privateKey);
		for (const [, privateKey] of Object.entries(rolePrivateKeys)) {
			web3.eth.accounts.wallet.add(privateKey);
		}

		owner = web3.eth.accounts.wallet[0].address;
		oracle = web3.eth.accounts.wallet[1].address;
		debtManager = web3.eth.accounts.wallet[2].address;
		feePeriodManager = web3.eth.accounts.wallet[3].address;
		minterManager = web3.eth.accounts.wallet[4].address;
	}
	const accounts = {
		owner: owner,
		oracle: oracle,
		debtManager: debtManager,
		feePeriodManager: feePeriodManager,
		minterManager: minterManager,
	};

	web3.eth.defaultAccount = owner;

	return { web3, etherscanLinkPrefix, accounts };
};

function getContractInstance({ network, deploymentPath, contract, web3, target, source }) {
	const { address } = getTarget({ network, contract: target || contract, deploymentPath });
	const { abi } = getSource({ network, contract: source || contract, deploymentPath });
	return new web3.eth.Contract(abi, address);
}

const scheduler = async ({
	network = DEFAULTS.network,
	methodCallGasLimit = DEFAULTS.methodCallGasLimit,
	gasPrice = DEFAULTS.gasPrice,
	deploymentPath,
	feedArgs = DEFAULTS.feedArgs,
	privateKey,
	providerUrl,
	cronScheduleFormat = DEFAULTS.cronScheduleFormat,
	tryCnt = DEFAULTS.tryCnt,
	publiclyCallable,
	priority,
	job,
	inflationalMintRatio,
}) => {
	if (!job) {
		throw new Error('must specify job to run');
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

	console.log('Starting Schedule');
	schedule.scheduleJob(cronScheduleFormat, async () => {
		console.log(`Running Schedule at ${new Date().toLocaleString()}`);

		let cnt = 0;
		let success = false;
		while (!success && cnt < tryCnt) {
			console.log(`trying to execute ${cnt} times at ${new Date().toLocaleString()}`);
			try {
				if (priority) {
					gasPrice = await checkGasPrice(network, priority);
				} else {
					console.log(`using gas price : ${gasPrice}`);
				}

				const runStep = async opts =>
					performTransactionalStep({
						gasLimit: methodCallGasLimit,
						publiclyCallable,
						gasPrice,
						...opts,
					});

				try {
					cnt++;

					if (job) {
						switch (job) {
							case 'inflationalMint':
								inflationalMint({
									network,
									deploymentPath,
									privateKey,
									providerUrl,
									runStep,
									inflationalMintRatio,
								});
								break;
							case 'updateRates':
								updateRates({
									network,
									deploymentPath,
									feedArgs,
									privateKey,
									providerUrl,
									runStep,
								});
								break;
							case 'takeDebtSnapshot':
								takeDebtSnapshot({ network, deploymentPath, privateKey, providerUrl, runStep });
								break;
							case 'closeCurrentFeePeriod':
								closeCurrentFeePeriod({
									network,
									deploymentPath,
									privateKey,
									providerUrl,
									runStep,
								});
								break;
							default:
								throw new Error(`${job} is not defined in scheduler.`);
						}
					}

					success = true;
				} catch (e) {
					console.log(e);
					await sleep(3000);
				}
			} catch (e) {
				console.log(`scheduler failed at ${new Date().toLocaleString()}`);
				console.log(e);
				await sleep(3000);
			}
		}
	});
};

const updateRates = async ({
	network,
	deploymentPath,
	feedArgs,
	providerUrl,
	privateKey,
	runStep,
}) => {
	const now = (new Date().getTime() / 1000).toFixed(0); // convert to epoch time
	const { web3, accounts, etherscanLinkPrefix } = getConnectionsByNetwork({
		network,
		providerUrl,
		privateKey,
	});

	const externalRateAggregator = getContractInstance({
		network,
		deploymentPath,
		contract: 'ExternalRateAggregator',
		web3,
	});

	// get last price of currency from gate.io
	const feedPriceArr = feedArgs.map(requestPriceFeedFromGateIO);

	if (feedPriceArr && feedPriceArr.length > 0) {
		Promise.all(feedPriceArr)
			.then(async data => {
				for (const { price, currencyKey } of data) {
					await runStep({
						contract: 'ExternalRateAggregator',
						target: externalRateAggregator,
						read: 'getRateAndUpdatedTime',
						readArg: toBytes32(currencyKey),
						expected: response => {
							const prevPrice = response[0];
							const lastUpdatedTime = response[1];

							const priceGap =
								prevPrice > price
									? toBN(prevPrice).sub(toBN(price))
									: toBN(price).sub(toBN(prevPrice));

							const deviation =
								prevPrice == 0
									? 0
									: multiplyDecimal(divideDecimal(priceGap, toBN(prevPrice)), toBN(100)).toString();

							// if no price is set, should update the rate
							if (prevPrice == 0 || lastUpdatedTime == 0) {
								return false;
							}

							// if deviation is higher than 5% , should update rates
							if (deviation >= 5) {
								return false;
							}

							// check if updated time has passed a day
							return lastUpdatedTime > now - 86400;
						},
						write: 'updateRates',
						writeArg: [[toBytes32(currencyKey)], [price], now],
						account: accounts.oracle,
						etherscanLinkPrefix,
					});
				}
			})
			.catch(err => console.log(err));
	}
};

const takeDebtSnapshot = async ({ network, deploymentPath, providerUrl, privateKey, runStep }) => {
	const now = (new Date().getTime() / 1000).toFixed(0); // convert to epoch time

	const { web3, accounts, etherscanLinkPrefix } = getConnectionsByNetwork({
		network,
		providerUrl,
		privateKey,
	});

	const debtCache = getContractInstance({ network, deploymentPath, contract: 'DebtCache', web3 });

	await runStep({
		contract: 'DebtCache',
		target: debtCache,
		read: 'cacheInfo',
		expected: input => {
			const cacheTimestamp = input[1];
			const cacheIsInvalid = input[2];
			const cacheStale = input[3];
			// every 12h or cache is stale or invalid
			return cacheTimestamp > now - 43200 && !cacheIsInvalid && !cacheStale;
		},
		write: 'takeDebtSnapshot',
		account: accounts.debtManager,
		etherscanLinkPrefix,
	});
};

const closeCurrentFeePeriod = async ({
	network,
	deploymentPath,
	providerUrl,
	privateKey,
	runStep,
}) => {
	const now = (new Date().getTime() / 1000).toFixed(0); // convert to epoch time

	const { web3, accounts, etherscanLinkPrefix } = getConnectionsByNetwork({
		network,
		providerUrl,
		privateKey,
	});

	const proxyFeePool = getContractInstance({
		network,
		deploymentPath,
		contract: 'FeePool',
		target: 'ProxyFeePool',
		web3,
	});

	const feePeriodDuration = ['bsc', 'polygon', 'mainnet'].includes(network)
		? FEE_PERIOD_DURATION
		: 1800;

	await runStep({
		contract: 'ProxyFeePool',
		target: proxyFeePool,
		read: 'recentFeePeriods',
		readArg: 0,
		expected: input => {
			const startTime = input[2];
			return startTime > now - feePeriodDuration;
		},
		write: 'closeCurrentFeePeriod',
		account: accounts.feePeriodManager,
		etherscanLinkPrefix,
	});
};

const inflationalMint = async ({
	network,
	deploymentPath,
	providerUrl,
	privateKey,
	runStep,
	inflationalMintRatio,
}) => {
	const { web3, accounts, etherscanLinkPrefix } = getConnectionsByNetwork({
		network,
		providerUrl,
		privateKey,
	});

	const source = ['polygon', 'mumbai'].includes(network)
		? 'PeriFinanceToPolygon'
		: ['bsc', 'bsctest'].includes(network)
		? 'PeriFinanceToBSC'
		: 'PeriFinanceToEthereum';

	const proxyPeriFinance = getContractInstance({
		network,
		deploymentPath,
		contract: 'PeriFinance',
		// target: 'ProxyERC20',
		source,
		web3,
	});

	const supplySchedule = getContractInstance({
		network,
		deploymentPath,
		contract: 'SupplySchedule',
		web3,
	});

	const isMintable = await supplySchedule.methods.isMintable().call();

	if (inflationalMintRatio && !isNaN(inflationalMintRatio)) {
		console.log(`${network} inflational mint ratio : ${inflationalMintRatio}`);
		await runStep({
			contract: 'PeriFinance',
			target: proxyPeriFinance,
			read: 'anyPynthOrPERIRateIsInvalid', // this doesnt do anything here
			expected: input => !isMintable,
			write: 'inflationalMint',
			writeArg: inflationalMintRatio,
			account: accounts.minterManager,
			etherscanLinkPrefix,
		});
	} else {
		const totalInflationMintSupply = toBN(
			await supplySchedule.methods.INITIAL_WEEKLY_SUPPLY().call()
		); // 76924719527063029689120

		const polygon_network = 'polygon';
		const { web3: web3_polygon } = getConnectionsByNetwork({ network: polygon_network });
		const deploymentPath_polygon = getDeploymentPathForNetwork({ network: polygon_network });
		const debtCache_polygon = getContractInstance({
			network: polygon_network,
			deploymentPath: deploymentPath_polygon,
			contract: 'DebtCache',
			web3: web3_polygon,
		});

		const rewardsDistribution_polygon = getContractInstance({
			network: polygon_network,
			deploymentPath: deploymentPath_polygon,
			contract: 'RewardsDistribution',
			web3: web3_polygon,
		});

		const distributionsLength_polygon = await rewardsDistribution_polygon.methods
			.distributionsLength()
			.call();

		let distributed_sum_polygon = toBN(0);
		const distributionDataArr_polygon = [];

		for (let i = 0; i < distributionsLength_polygon; i++) {
			const distributionData = await rewardsDistribution_polygon.methods.distributions(i).call();
			distributionDataArr_polygon.push(distributionData[1]);
		}

		await Promise.all(distributionDataArr_polygon)
			.then(data => {
				distributed_sum_polygon = data.reduce(
					(totalReserved, reservedAmount) => totalReserved.add(toBN(reservedAmount)),
					toBN(0)
				);
			})
			.catch(e => console.log(e));

		const bsc_network = 'bsc';
		const { web3: web3_bsc } = getConnectionsByNetwork({ network: bsc_network });
		const deploymentPath_bsc = getDeploymentPathForNetwork({ network: bsc_network });
		const debtCache_bsc = getContractInstance({
			network: bsc_network,
			deploymentPath: deploymentPath_bsc,
			contract: 'DebtCache',
			web3: web3_bsc,
		});

		const rewardsDistribution_bsc = getContractInstance({
			network: bsc_network,
			deploymentPath: deploymentPath_bsc,
			contract: 'RewardsDistribution',
			web3: web3_bsc,
		});

		const distributionsLength_bsc = await rewardsDistribution_bsc.methods
			.distributionsLength()
			.call();

		let distributed_sum_bsc = toBN(0);
		const distributionDataArr_bsc = [];

		for (let i = 0; i < distributionsLength_bsc; i++) {
			const distributionData = await rewardsDistribution_bsc.methods.distributions(i).call();
			distributionDataArr_bsc.push(distributionData[1]);
		}

		await Promise.all(distributionDataArr_bsc)
			.then(data => {
				distributed_sum_bsc = data.reduce(
					(totalReserved, reservedAmount) => totalReserved.add(toBN(reservedAmount)),
					toBN(0)
				);
			})
			.catch(e => console.log(e));

		const mainnet_network = 'mainnet';
		const { web3: web3_mainnet } = getConnectionsByNetwork({ network: mainnet_network });
		const deploymentPath_mainnet = getDeploymentPathForNetwork({ network: mainnet_network });
		const debtCache_mainnet = getContractInstance({
			network: mainnet_network,
			deploymentPath: deploymentPath_mainnet,
			contract: 'DebtCache',
			web3: web3_mainnet,
		});

		const rewardsDistribution_mainnet = getContractInstance({
			network: mainnet_network,
			deploymentPath: deploymentPath_mainnet,
			contract: 'RewardsDistribution',
			web3: web3_mainnet,
		});

		const distributionsLength_mainnet = await rewardsDistribution_mainnet.methods
			.distributionsLength()
			.call();

		let distributed_sum_mainnet = toBN(0);
		const distributionDataArr_mainnet = [];

		for (let i = 0; i < distributionsLength_mainnet; i++) {
			const distributionData = await rewardsDistribution_mainnet.methods.distributions(i).call();
			distributionDataArr_mainnet.push(distributionData[1]);
		}

		await Promise.all(distributionDataArr_mainnet)
			.then(data => {
				distributed_sum_mainnet = data.reduce(
					(totalReserved, reservedAmount) => totalReserved.add(toBN(reservedAmount)),
					toBN(0)
				);
			})
			.catch(e => console.log(e));

		console.log('\n------------- calculating ratio for each network -------------\n');
		const pureMintAmount = totalInflationMintSupply
			.sub(distributed_sum_polygon)
			.sub(distributed_sum_bsc)
			.sub(distributed_sum_mainnet);

		const polygonDebt = toBN(await debtCache_polygon.methods.cachedDebt().call());
		const bscDebt = toBN(await debtCache_bsc.methods.cachedDebt().call());
		const mainnetDebt = toBN(await debtCache_mainnet.methods.cachedDebt().call());

		const totalDebt = polygonDebt.add(bscDebt);

		const polygonMintAmount = multiplyDecimal(
			pureMintAmount,
			divideDecimal(polygonDebt, totalDebt)
		).add(distributed_sum_polygon);
		const bscMintAmount = multiplyDecimal(pureMintAmount, divideDecimal(bscDebt, totalDebt)).add(
			distributed_sum_bsc
		);
		const mainnetMintAmount = multiplyDecimal(
			pureMintAmount,
			divideDecimal(mainnetDebt, totalDebt)
		).add(distributed_sum_mainnet);

		const polygonRatio = divideDecimal(polygonMintAmount, totalInflationMintSupply);
		const bscRatio = divideDecimal(bscMintAmount, totalInflationMintSupply);
		const mainnetRatio = divideDecimal(mainnetMintAmount, totalInflationMintSupply);

		console.log('polygon ratio : ', fromWei(polygonRatio));
		console.log('bsc ratio : ', fromWei(bscRatio));
		console.log('mainnet ratio : ', fromWei(mainnetRatio));

		await runStep({
			contract: 'PeriFinance',
			target: proxyPeriFinance,
			read: 'anyPynthOrPERIRateIsInvalid', // this doesnt do anything here
			expected: input => !isMintable,
			write: 'inflationalMint',
			writeArg: ['bsc', 'bsctest'].includes(network)
				? bscRatio
				: ['polygon', 'mumbai'].includes(network)
				? polygonRatio
				: mainnetRatio,
			account: accounts.minterManager,
			etherscanLinkPrefix,
		});
	}
};

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
			.option('-imr, --inflational-mint-ratio <value>', 'inflationalMintRatio for network', toWei)
			.option('-g, --gas-price <value>', 'Gas price in GWEI', DEFAULTS.gasPrice)
			.option('-j, --job <value>', `The name of the job to execute`)
			.option(
				'-f, --feed-args <value>',
				`feed Arguments ["PERI", "USDC", "DAI"]`,
				x => x.split(','),
				DEFAULTS.feedArgs
			)
			.option('-csf, --cron-schedule-format <value>', `cron schedule format for scheduler`)
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
				'set setimated gas price, available options : ["safeLow", "standard", "fast"]',
				x => x.toLowerCase()
			)
			.action(scheduler),
};
