const fs = require('fs');
const path = require('path');
const assert = require('assert');
const pLimit = require('p-limit');

const { isAddress } = require('web3-utils');
const Web3 = require('web3');
const isCI = require('is-ci');

const { loadCompiledFiles } = require('../../publish/src/solidity');

const deployStakingRewardsCmd = require('../../publish/src/commands/deploy-staking-rewards');
const deployShortingRewardsCmd = require('../../publish/src/commands/deploy-shorting-rewards');
const deployCmd = require('../../publish/src/commands/deploy');
const { buildPath } = deployCmd.DEFAULTS;
const testUtils = require('../utils');

const commands = {
	build: require('../../publish/src/commands/build').build,
	deploy: deployCmd.deploy,
	deployStakingRewards: deployStakingRewardsCmd.deployStakingRewards,
	deployShortingRewards: deployShortingRewardsCmd.deployShortingRewards,
	replacePynths: require('../../publish/src/commands/replace-pynths').replacePynths,
	purgePynths: require('../../publish/src/commands/purge-pynths').purgePynths,
	removePynths: require('../../publish/src/commands/remove-pynths').removePynths,
	importFeePeriods: require('../../publish/src/commands/import-fee-periods').importFeePeriods,
};

const peri = require('../..');
const {
	toBytes32,
	constants: {
		STAKING_REWARDS_FILENAME,
		CONFIG_FILENAME,
		DEPLOYMENT_FILENAME,
		PYNTHS_FILENAME,
		FEEDS_FILENAME,
	},
	defaults: {
		WAITING_PERIOD_SECS,
		PRICE_DEVIATION_THRESHOLD_FACTOR,
		ISSUANCE_RATIO,
		FEE_PERIOD_DURATION,
		TARGET_THRESHOLD,
		LIQUIDATION_DELAY,
		LIQUIDATION_RATIO,
		LIQUIDATION_PENALTY,
		RATE_STALE_PERIOD,
		EXCHANGE_FEE_RATES,
		MINIMUM_STAKE_TIME,
		TRADING_REWARDS_ENABLED,
		DEBT_SNAPSHOT_STALE_TIME,
	},
	wrap,
} = peri;

const concurrency = isCI ? 1 : 10;
const limitPromise = pLimit(concurrency);

describe('publish scripts', () => {
	const network = 'local';

	const {
		getSource,
		getTarget,
		getPynths,
		getPathToNetwork,
		getStakingRewards,
		getShortingRewards,
	} = wrap({
		network,
		fs,
		path,
	});

	const deploymentPath = getPathToNetwork();

	// track these files to revert them later on
	const rewardsJSONPath = path.join(deploymentPath, STAKING_REWARDS_FILENAME);
	const rewardsJSON = fs.readFileSync(rewardsJSONPath);
	const pynthsJSONPath = path.join(deploymentPath, PYNTHS_FILENAME);
	const pynthsJSON = fs.readFileSync(pynthsJSONPath);
	const configJSONPath = path.join(deploymentPath, CONFIG_FILENAME);
	const configJSON = fs.readFileSync(configJSONPath);
	const deploymentJSONPath = path.join(deploymentPath, DEPLOYMENT_FILENAME);
	const feedsJSONPath = path.join(deploymentPath, FEEDS_FILENAME);
	const feedsJSON = fs.readFileSync(feedsJSONPath);

	const logfilePath = path.join(__dirname, 'test.log');
	let gasLimit;
	let gasPrice;
	let accounts;
	let pUSD;
	let pBTC;
	let pETH;
	let web3;
	let fastForward;

	const resetConfigAndPynthFiles = () => {
		// restore the pynths and config files for this env (cause removal updated it)
		fs.writeFileSync(pynthsJSONPath, pynthsJSON);
		fs.writeFileSync(rewardsJSONPath, rewardsJSON);
		fs.writeFileSync(configJSONPath, configJSON);
		fs.writeFileSync(feedsJSONPath, feedsJSON);

		// and reset the deployment.json to signify new deploy
		fs.writeFileSync(deploymentJSONPath, JSON.stringify({ targets: {}, sources: {} }));
	};

	const callMethodWithRetry = async method => {
		let response;

		try {
			response = await method.call();
		} catch (err) {
			console.log('Error detected looking up value. Ignoring and trying again.', err);
			// retry
			response = await method.call();
		}

		return limitPromise(() => response);
	};

	before(() => {
		fs.writeFileSync(logfilePath, ''); // reset log file
		fs.writeFileSync(deploymentJSONPath, JSON.stringify({ targets: {}, sources: {} }));
	});

	beforeEach(async () => {
		console.log = (...input) => fs.appendFileSync(logfilePath, input.join(' ') + '\n');

		web3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:8545'));

		let loadLocalUsers;
		let isCompileRequired;

		({ loadLocalUsers, isCompileRequired, fastForward } = testUtils({ web3 }));

		// load accounts used by local EVM
		const users = loadLocalUsers();

		accounts = {
			deployer: users[0],
			first: users[1],
			second: users[2],
		};

		if (isCompileRequired()) {
			console.log('Found source file modified after build. Rebuilding...');

			await commands.build({ showContractSize: true, testHelpers: true });
		} else {
			console.log('Skipping build as everything up to date');
		}

		gasLimit = 5000000;
		[pUSD, pBTC, pETH] = ['pUSD', 'pBTC', 'pETH'].map(toBytes32);
		web3.eth.accounts.wallet.add(accounts.deployer.private);
		gasPrice = web3.utils.toWei('5', 'gwei');
	});

	afterEach(resetConfigAndPynthFiles);

	describe('integrated actions test', () => {
		describe('when deployed', () => {
			let rewards;
			let sources;
			let targets;
			let pynths;
			let PeriFinance;
			let timestamp;
			let pUSDContract;
			let pBTCContract;
			let pETHContract;
			let FeePool;
			let DebtCache;
			let Exchanger;
			let Issuer;
			let SystemSettings;
			let Liquidations;
			let ExchangeRates;
			const aggregators = {};

			const getContract = ({ target, source }) =>
				new web3.eth.Contract(
					(sources[source] || sources[targets[target].source]).abi,
					targets[target].address
				);

			const createMockAggregator = async () => {
				// get last build
				const { compiled } = loadCompiledFiles({ buildPath });
				const {
					abi,
					evm: {
						bytecode: { object: bytecode },
					},
				} = compiled['MockAggregatorV2V3'];
				const MockAggregator = new web3.eth.Contract(abi);
				const instance = await MockAggregator.deploy({
					data: '0x' + bytecode,
				}).send({
					from: accounts.deployer.public,
					gas: gasLimit,
					gasPrice,
				});
				await instance.methods.setDecimals('8').send({
					from: accounts.deployer.public,
					gas: gasLimit,
					gasPrice,
				});
				return instance;
			};

			const setAggregatorAnswer = async ({ asset, rate }) => {
				const result = await aggregators[asset].methods
					.setLatestAnswer((rate * 1e8).toString(), timestamp)
					.send({
						from: accounts.deployer.public,
						gas: gasLimit,
						gasPrice,
					});
				// Cache the debt to make sure nothing's wrong/stale after the rate update.
				await DebtCache.methods.takeDebtSnapshot().send({
					from: accounts.deployer.public,
					gas: gasLimit,
					gasPrice,
				});
				return result;
			};

			beforeEach(async () => {
				timestamp = (await web3.eth.getBlock('latest')).timestamp;

				// deploy a mock aggregator for all supported rates
				const feeds = JSON.parse(feedsJSON);
				for (const feedEntry of Object.values(feeds)) {
					const aggregator = await createMockAggregator();
					aggregators[feedEntry.asset] = aggregator;
					feedEntry.feed = aggregator.options.address;
				}
				fs.writeFileSync(feedsJSONPath, JSON.stringify(feeds));

				await commands.deploy({
					concurrency,
					network,
					freshDeploy: true,
					yes: true,
					privateKey: accounts.deployer.private,
				});

				sources = getSource();
				targets = getTarget();
				pynths = getPynths().filter(({ name }) => name !== 'pUSD');

				PeriFinance = getContract({ target: 'ProxyERC20', source: 'PeriFinance' });
				FeePool = getContract({ target: 'ProxyFeePool', source: 'FeePool' });
				Exchanger = getContract({ target: 'Exchanger' });
				DebtCache = getContract({ target: 'DebtCache' });

				Issuer = getContract({ target: 'Issuer' });

				pUSDContract = getContract({ target: 'ProxyERC20pUSD', source: 'Pynth' });

				pBTCContract = getContract({ target: 'ProxypBTC', source: 'Pynth' });
				pETHContract = getContract({ target: 'ProxypETH', source: 'Pynth' });
				SystemSettings = getContract({ target: 'SystemSettings' });

				Liquidations = getContract({ target: 'Liquidations' });

				ExchangeRates = getContract({ target: 'ExchangeRates' });
			});

			describe('default system settings', () => {
				it('defaults are properly configured in a fresh deploy', async () => {
					assert.strictEqual(
						await Exchanger.methods.waitingPeriodSecs().call(),
						WAITING_PERIOD_SECS
					);
					assert.strictEqual(
						await Exchanger.methods.priceDeviationThresholdFactor().call(),
						PRICE_DEVIATION_THRESHOLD_FACTOR
					);
					assert.strictEqual(
						await Exchanger.methods.tradingRewardsEnabled().call(),
						TRADING_REWARDS_ENABLED
					);
					assert.strictEqual(await Issuer.methods.issuanceRatio().call(), ISSUANCE_RATIO);
					assert.strictEqual(await FeePool.methods.feePeriodDuration().call(), FEE_PERIOD_DURATION);
					assert.strictEqual(
						await FeePool.methods.targetThreshold().call(),
						web3.utils.toWei((TARGET_THRESHOLD / 100).toString())
					);

					assert.strictEqual(
						await Liquidations.methods.liquidationDelay().call(),
						LIQUIDATION_DELAY
					);
					assert.strictEqual(
						await Liquidations.methods.liquidationRatio().call(),
						LIQUIDATION_RATIO
					);
					assert.strictEqual(
						await Liquidations.methods.liquidationPenalty().call(),
						LIQUIDATION_PENALTY
					);
					assert.strictEqual(
						await ExchangeRates.methods.rateStalePeriod().call(),
						RATE_STALE_PERIOD
					);
					assert.strictEqual(
						await DebtCache.methods.debtSnapshotStaleTime().call(),
						DEBT_SNAPSHOT_STALE_TIME
					);
					assert.strictEqual(await Issuer.methods.minimumStakeTime().call(), MINIMUM_STAKE_TIME);
					for (const [category, rate] of Object.entries(EXCHANGE_FEE_RATES)) {
						// take the first pynth we can find from that category, ignoring ETH and BTC as
						// they deviate from the rest of the pynth fee category defaults
						const pynth = pynths.find(
							({ category: c, name }) => c === category && !/^.(BTC|ETH)$/.test(name)
						);

						assert.strictEqual(
							await Exchanger.methods
								.feeRateForExchange(toBytes32('(ignored)'), toBytes32(pynth.name))
								.call(),
							rate
						);
					}
				});

				describe('when defaults are changed', () => {
					let newWaitingPeriod;
					let newPriceDeviation;
					let newIssuanceRatio;
					let newFeePeriodDuration;
					let newTargetThreshold;
					let newLiquidationsDelay;
					let newLiquidationsRatio;
					let newLiquidationsPenalty;
					let newRateStalePeriod;
					let newRateForpUSD;
					let newMinimumStakeTime;
					let newDebtSnapshotStaleTime;

					beforeEach(async () => {
						newWaitingPeriod = '10';
						newPriceDeviation = web3.utils.toWei('0.45');
						newIssuanceRatio = web3.utils.toWei('0.25');
						newFeePeriodDuration = (3600 * 24 * 3).toString(); // 3 days
						newTargetThreshold = '6';
						newLiquidationsDelay = newFeePeriodDuration;
						newLiquidationsRatio = web3.utils.toWei('0.6'); // must be above newIssuanceRatio * 2
						newLiquidationsPenalty = web3.utils.toWei('0.25');
						newRateStalePeriod = '3400';
						newRateForpUSD = web3.utils.toWei('0.1');
						newMinimumStakeTime = '3999';
						newDebtSnapshotStaleTime = '43200'; // Half a day

						await SystemSettings.methods.setWaitingPeriodSecs(newWaitingPeriod).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setPriceDeviationThresholdFactor(newPriceDeviation).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setIssuanceRatio(newIssuanceRatio).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setFeePeriodDuration(newFeePeriodDuration).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setTargetThreshold(newTargetThreshold).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});

						await SystemSettings.methods.setLiquidationDelay(newLiquidationsDelay).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setLiquidationRatio(newLiquidationsRatio).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setLiquidationPenalty(newLiquidationsPenalty).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setRateStalePeriod(newRateStalePeriod).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setDebtSnapshotStaleTime(newDebtSnapshotStaleTime).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods.setMinimumStakeTime(newMinimumStakeTime).send({
							from: accounts.deployer.public,
							gas: gasLimit,
							gasPrice,
						});
						await SystemSettings.methods
							.setExchangeFeeRateForPynths([toBytes32('pUSD')], [newRateForpUSD])
							.send({
								from: accounts.deployer.public,
								gas: gasLimit,
								gasPrice,
							});
					});
					describe('when redeployed with a new system settings contract', () => {
						beforeEach(async () => {
							// read current config file version (if something has been removed,
							// we don't want to include it here)
							const currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
							const configForExrates = Object.keys(currentConfigFile).reduce((memo, cur) => {
								memo[cur] = { deploy: cur === 'SystemSettings' };
								return memo;
							}, {});

							fs.writeFileSync(configJSONPath, JSON.stringify(configForExrates));

							await commands.deploy({
								concurrency,
								network,
								yes: true,
								privateKey: accounts.deployer.private,
							});
						});
						it('then the defaults remain unchanged', async () => {
							assert.strictEqual(
								await Exchanger.methods.waitingPeriodSecs().call(),
								newWaitingPeriod
							);
							assert.strictEqual(
								await Exchanger.methods.priceDeviationThresholdFactor().call(),
								newPriceDeviation
							);
							assert.strictEqual(await Issuer.methods.issuanceRatio().call(), newIssuanceRatio);
							assert.strictEqual(
								await FeePool.methods.feePeriodDuration().call(),
								newFeePeriodDuration
							);
							assert.strictEqual(
								await FeePool.methods.targetThreshold().call(),
								web3.utils.toWei((newTargetThreshold / 100).toString())
							);
							assert.strictEqual(
								await Liquidations.methods.liquidationDelay().call(),
								newLiquidationsDelay
							);
							assert.strictEqual(
								await Liquidations.methods.liquidationRatio().call(),
								newLiquidationsRatio
							);
							assert.strictEqual(
								await Liquidations.methods.liquidationPenalty().call(),
								newLiquidationsPenalty
							);
							assert.strictEqual(
								await ExchangeRates.methods.rateStalePeriod().call(),
								newRateStalePeriod
							);
							assert.strictEqual(
								await Issuer.methods.minimumStakeTime().call(),
								newMinimumStakeTime
							);
							assert.strictEqual(
								await Exchanger.methods
									.feeRateForExchange(toBytes32('(ignored)'), toBytes32('pUSD'))
									.call(),
								newRateForpUSD
							);
						});
					});
				});
			});

			describe('pynths added to Issuer', () => {
				it('then all pynths are added to the issuer', async () => {
					const keys = await Issuer.methods.availableCurrencyKeys().call();
					assert.deepStrictEqual(
						keys.map(web3.utils.hexToUtf8),
						JSON.parse(pynthsJSON).map(({ name }) => name)
					);
				});
				describe('when only pUSD and pETH is chosen as a pynth', () => {
					beforeEach(async () => {
						fs.writeFileSync(
							pynthsJSONPath,
							JSON.stringify([
								{ name: 'pUSD', asset: 'USD' },
								{ name: 'pETH', asset: 'ETH' },
							])
						);
					});
					describe('when Issuer redeployed', () => {
						beforeEach(async () => {
							const currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
							const configForExrates = Object.keys(currentConfigFile).reduce((memo, cur) => {
								memo[cur] = { deploy: cur === 'Issuer' };
								return memo;
							}, {});

							fs.writeFileSync(configJSONPath, JSON.stringify(configForExrates));

							await commands.deploy({
								concurrency,
								addNewPynths: true,
								network,
								yes: true,
								privateKey: accounts.deployer.private,
							});
							targets = getTarget();
							Issuer = getContract({ target: 'Issuer' });
						});
						it('then only pUSD is added to the issuer', async () => {
							const keys = await Issuer.methods.availableCurrencyKeys().call();
							assert.deepStrictEqual(keys.map(web3.utils.hexToUtf8), ['pUSD', 'pETH']);
						});
					});
				});
			});
			describe('deploy-staking-rewards', () => {
				beforeEach(async () => {
					const rewardsToDeploy = [
						'pETHUniswapV1',
						'pXAUUniswapV2',
						'pUSDCurve',
						'iETH',
						'iETH2',
						'iETH3',
						'iBTC',
						'PERIBalancer',
					];

					await commands.deployStakingRewards({
						network,
						yes: true,
						privateKey: accounts.deployer.private,
						rewardsToDeploy,
					});

					rewards = getStakingRewards();
					sources = getSource();
					targets = getTarget();
				});

				it('script works as intended', async () => {
					for (const { name, stakingToken, rewardsToken } of rewards) {
						const stakingRewardsName = `StakingRewards${name}`;
						const stakingRewardsContract = getContract({ target: stakingRewardsName });

						// Test staking / rewards token address
						const tokens = [
							{ token: stakingToken, method: 'stakingToken' },
							{ token: rewardsToken, method: 'rewardsToken' },
						];

						for (const { token, method } of tokens) {
							const tokenAddress = await stakingRewardsContract.methods[method]().call();

							if (isAddress(token)) {
								assert.strictEqual(token.toLowerCase(), tokenAddress.toLowerCase());
							} else {
								assert.strictEqual(
									tokenAddress.toLowerCase(),
									targets[token].address.toLowerCase()
								);
							}
						}

						// Test rewards distribution address
						const rewardsDistributionAddress = await stakingRewardsContract.methods
							.rewardsDistribution()
							.call();
						assert.strictEqual(
							rewardsDistributionAddress.toLowerCase(),
							targets['RewardsDistribution'].address.toLowerCase()
						);
					}
				});
			});

			describe('deploy-shorting-rewards', () => {
				beforeEach(async () => {
					const rewardsToDeploy = ['pBTC', 'pETH'];

					await commands.deployShortingRewards({
						network,
						yes: true,
						privateKey: accounts.deployer.private,
						rewardsToDeploy,
					});

					rewards = getShortingRewards();
					sources = getSource();
					targets = getTarget();
				});

				it('script works as intended', async () => {
					for (const { name, rewardsToken } of rewards) {
						const shortingRewardsName = `ShortingRewards${name}`;
						const shortingRewardsContract = getContract({ target: shortingRewardsName });

						const tokenAddress = await shortingRewardsContract.methods.rewardsToken().call();

						if (isAddress(rewardsToken)) {
							assert.strictEqual(rewardsToken.toLowerCase(), tokenAddress.toLowerCase());
						} else {
							assert.strictEqual(
								tokenAddress.toLowerCase(),
								targets[rewardsToken].address.toLowerCase()
							);
						}

						// Test rewards distribution address should be the deployer, since we are
						// funding by the sDAO for the trial.
						const rewardsDistributionAddress = await shortingRewardsContract.methods
							.rewardsDistribution()
							.call();
						assert.strictEqual(
							rewardsDistributionAddress.toLowerCase(),
							accounts.deployer.public.toLowerCase()
						);
					}
				});
			});

			describe('importFeePeriods script', () => {
				let oldFeePoolAddress;
				let feePeriodLength;

				beforeEach(async () => {
					oldFeePoolAddress = getTarget({ contract: 'FeePool' }).address;
					feePeriodLength = await callMethodWithRetry(FeePool.methods.FEE_PERIOD_LENGTH());
				});

				const daysAgo = days => Math.round(Date.now() / 1000 - 3600 * 24 * days);

				const redeployFeePeriodOnly = async function() {
					// read current config file version (if something has been removed,
					// we don't want to include it here)
					const currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
					const configForExrates = Object.keys(currentConfigFile).reduce((memo, cur) => {
						memo[cur] = { deploy: cur === 'FeePool' };
						return memo;
					}, {});

					fs.writeFileSync(configJSONPath, JSON.stringify(configForExrates));

					await commands.deploy({
						concurrency,
						network,
						yes: true,
						privateKey: accounts.deployer.private,
					});
				};

				describe('when import script is called with the same source fee pool as the currently deployed one', () => {
					it('then it fails', done => {
						commands
							.importFeePeriods({
								sourceContractAddress: oldFeePoolAddress,
								network,
								privateKey: accounts.deployer.private,
								yes: true,
							})
							.then(() => done('Should not succeed.'))
							.catch(() => done());
					});
				});
				describe('when FeePool alone is redeployed', () => {
					beforeEach(redeployFeePeriodOnly);

					describe('when new fee periods are attempted to be imported', () => {
						it('fails as there isnt more than a single period', done => {
							commands
								.importFeePeriods({
									sourceContractAddress: oldFeePoolAddress,
									network,
									privateKey: accounts.deployer.private,
									yes: true,
								})
								.then(() => done('Should not succeed.'))
								.catch(() => done());
						});
					});
				});

				describe('when FeePool is given three true imported periods', () => {
					let periodsAdded;
					beforeEach(async () => {
						periodsAdded = [];
						const addPeriod = (feePeriodId, startTime) => {
							periodsAdded.push({
								feePeriodId,
								startingDebtIndex: '0',
								startTime,
								feesToDistribute: '0',
								feesClaimed: '0',
								rewardsToDistribute: '0',
								rewardsClaimed: '0',
							});
						};
						for (let i = 0; i < feePeriodLength; i++) {
							const startTime = daysAgo((i + 1) * 6);
							addPeriod((i + 1).toString(), startTime.toString());
							await FeePool.methods.importFeePeriod(i, i + 1, 0, startTime, 0, 0, 0, 0).send({
								from: accounts.deployer.public,
								gas: gasLimit,
								gasPrice,
							});
						}
					});
					describe('when the new FeePool is invalid', () => {
						describe('when FeePool alone is redeployed', () => {
							beforeEach(redeployFeePeriodOnly);
							describe('using the FeePoolNew', () => {
								let FeePoolNew;
								beforeEach(async () => {
									targets = getTarget();
									FeePoolNew = getContract({ target: 'FeePool' });
								});

								describe('when the new FeePool is manually given fee periods', () => {
									beforeEach(async () => {
										for (let i = 0; i < feePeriodLength; i++) {
											await FeePoolNew.methods
												.importFeePeriod(i, i + 1, 0, daysAgo((i + 1) * 6), 0, 0, 0, 0)
												.send({
													from: accounts.deployer.public,
													gas: gasLimit,
													gasPrice,
												});
										}
									});
									describe('when new fee periods are attempted to be imported', () => {
										it('fails as the target FeePool now has imported fee periods', done => {
											commands
												.importFeePeriods({
													sourceContractAddress: oldFeePoolAddress,
													network,
													privateKey: accounts.deployer.private,
													yes: true,
												})
												.then(() => done('Should not succeed.'))
												.catch(() => done());
										});
									});
								});
							});
						});
					});
					describe('when FeePool alone is redeployed', () => {
						beforeEach(redeployFeePeriodOnly);
						describe('using the FeePoolNew', () => {
							let FeePoolNew;
							beforeEach(async () => {
								targets = getTarget();
								FeePoolNew = getContract({ target: 'FeePool' });
							});

							describe('when import is called', () => {
								beforeEach(async () => {
									await commands.importFeePeriods({
										sourceContractAddress: oldFeePoolAddress,
										network,
										privateKey: accounts.deployer.private,
										yes: true,
									});
								});
								it('then the periods are added correctly', async () => {
									const periods = await Promise.all(
										[0, 1].map(i => callMethodWithRetry(FeePoolNew.methods.recentFeePeriods(i)))
									);
									// strip index props off the returned object
									periods.forEach(period =>
										Object.keys(period)
											.filter(key => /^[0-9]+$/.test(key))
											.forEach(key => delete period[key])
									);

									assert.strictEqual(JSON.stringify(periods[0]), JSON.stringify(periodsAdded[0]));
									assert.strictEqual(JSON.stringify(periods[1]), JSON.stringify(periodsAdded[1]));
								});
							});
						});
					});
					describe('when FeePool is given old import periods', () => {
						beforeEach(async () => {
							for (let i = 0; i < feePeriodLength; i++) {
								await FeePool.methods
									.importFeePeriod(i, i + 1, 0, daysAgo((i + 1) * 14), 0, 0, 0, 0)
									.send({
										from: accounts.deployer.public,
										gas: gasLimit,
										gasPrice,
									});
							}
						});
						describe('when FeePool alone is redeployed', () => {
							beforeEach(redeployFeePeriodOnly);

							describe('when new fee periods are attempted to be imported', () => {
								it('fails as the most recent period is older than 1week', done => {
									commands
										.importFeePeriods({
											sourceContractAddress: oldFeePoolAddress,
											network,
											privateKey: accounts.deployer.private,
											yes: true,
										})
										.then(() => done('Should not succeed.'))
										.catch(() => done());
								});
							});
						});
					});
				});
			});

			describe('when ExchangeRates has prices PERI $0.30 and all pynths $1', () => {
				beforeEach(async () => {
					// set default issuance of 0.2
					await SystemSettings.methods.setIssuanceRatio(web3.utils.toWei('0.2')).send({
						from: accounts.deployer.public,
						gas: gasLimit,
						gasPrice,
					});

					// make sure exchange rates has prices for specific assets

					const answersToSet = [{ asset: 'PERI', rate: 0.3 }].concat(
						pynths.map(({ inverted, asset }) => {
							// as the same assets are used for long and shorts, search by asset rather than
							// name (currencyKey) here so that we don't accidentially override an inverse with
							// another rate
							if (asset === 'DEFI') {
								// ensure iDEFI is frozen at the lower limit, by setting the incoming rate
								// above the upper limit
								return {
									asset,
									rate: 9999999999,
								};
							} else if (asset === 'TRX') {
								// ensure iTRX is frozen at the upper limit, by setting the incoming rate
								// below the lower limit
								return {
									asset,
									rate: 0.000001,
								};
							} else if (asset === 'BNB') {
								// ensure iBNB is not frozen
								return {
									asset,
									rate: pynths.find(pynth => pynth.inverted && pynth.asset === asset).inverted
										.entryPoint,
								};
							} else if (asset === 'XTZ') {
								// ensure iXTZ is frozen at upper limit
								return {
									asset,
									rate: 0.000001,
								};
							} else if (asset === 'CEX') {
								// ensure iCEX is frozen at lower limit
								return {
									asset,
									rate: 9999999999,
								};
							}
							return {
								asset,
								rate: 1,
							};
						})
					);

					for (const { asset, rate } of answersToSet) {
						await setAggregatorAnswer({ asset, rate });
					}
				});

				describe('when transferring 100k PERI to user1', () => {
					beforeEach(async () => {
						// transfer PERI to first account
						await PeriFinance.methods
							.transfer(accounts.first.public, web3.utils.toWei('100000'))
							.send({
								from: accounts.deployer.public,
								gas: gasLimit,
								gasPrice,
							});
					});

					describe('when user1 issues all possible pUSD', () => {
						beforeEach(async () => {
							await PeriFinance.methods.issueMaxPynths().send({
								from: accounts.first.public,
								gas: gasLimit,
								gasPrice,
							});
						});
						it('then the pUSD balanced must be 100k * 0.3 * 0.2 (default SystemSettings.issuanceRatio) = 6000', async () => {
							const balance = await callMethodWithRetry(
								pUSDContract.methods.balanceOf(accounts.first.public)
							);
							assert.strictEqual(web3.utils.fromWei(balance), '6000', 'Balance should match');
						});
						describe('when user1 exchange 1000 pUSD for pETH (the MultiCollateralPynth)', () => {
							let pETHBalanceAfterExchange;
							beforeEach(async () => {
								await PeriFinance.methods.exchange(pUSD, web3.utils.toWei('1000'), pETH).send({
									from: accounts.first.public,
									gas: gasLimit,
									gasPrice,
								});
								pETHBalanceAfterExchange = await callMethodWithRetry(
									pETHContract.methods.balanceOf(accounts.first.public)
								);
							});
							it('then their pUSD balance is 5000', async () => {
								const balance = await callMethodWithRetry(
									pUSDContract.methods.balanceOf(accounts.first.public)
								);
								assert.strictEqual(web3.utils.fromWei(balance), '5000', 'Balance should match');
							});
							it('and their pETH balance is 1000 - the fee', async () => {
								const { amountReceived } = await callMethodWithRetry(
									Exchanger.methods.getAmountsForExchange(web3.utils.toWei('1000'), pUSD, pETH)
								);
								assert.strictEqual(
									web3.utils.fromWei(pETHBalanceAfterExchange),
									web3.utils.fromWei(amountReceived),
									'Balance should match'
								);
							});
						});
						describe('when user1 exchange 1000 pUSD for pBTC', () => {
							let pBTCBalanceAfterExchange;
							beforeEach(async () => {
								await PeriFinance.methods.exchange(pUSD, web3.utils.toWei('1000'), pBTC).send({
									from: accounts.first.public,
									gas: gasLimit,
									gasPrice,
								});
								pBTCBalanceAfterExchange = await callMethodWithRetry(
									pBTCContract.methods.balanceOf(accounts.first.public)
								);
							});
							it('then their pUSD balance is 5000', async () => {
								const balance = await callMethodWithRetry(
									pUSDContract.methods.balanceOf(accounts.first.public)
								);
								assert.strictEqual(web3.utils.fromWei(balance), '5000', 'Balance should match');
							});
							it('and their pBTC balance is 1000 - the fee', async () => {
								const { amountReceived } = await callMethodWithRetry(
									Exchanger.methods.getAmountsForExchange(web3.utils.toWei('1000'), pUSD, pBTC)
								);
								assert.strictEqual(
									web3.utils.fromWei(pBTCBalanceAfterExchange),
									web3.utils.fromWei(amountReceived),
									'Balance should match'
								);
							});
							describe('when user1 burns 10 pUSD', () => {
								beforeEach(async () => {
									// set minimumStakeTime to 0 seconds for burning
									await SystemSettings.methods.setMinimumStakeTime(0).send({
										from: accounts.deployer.public,
										gas: gasLimit,
										gasPrice,
									});
									// burn
									await PeriFinance.methods.burnPynths(web3.utils.toWei('10')).send({
										from: accounts.first.public,
										gas: gasLimit,
										gasPrice,
									});
								});
								it('then their pUSD balance is 4990', async () => {
									const balance = await callMethodWithRetry(
										pUSDContract.methods.balanceOf(accounts.first.public)
									);
									assert.strictEqual(web3.utils.fromWei(balance), '4990', 'Balance should match');
								});

								describe('when deployer replaces pBTC with PurgeablePynth', () => {
									beforeEach(async () => {
										await commands.replacePynths({
											network,
											yes: true,
											privateKey: accounts.deployer.private,
											subclass: 'PurgeablePynth',
											pynthsToReplace: ['pBTC'],
											methodCallGasLimit: gasLimit,
										});
									});
									describe('and deployer invokes purge', () => {
										beforeEach(async () => {
											fastForward(500); // fast forward through waiting period

											await commands.purgePynths({
												network,
												yes: true,
												privateKey: accounts.deployer.private,
												addresses: [accounts.first.public],
												pynthsToPurge: ['pBTC'],
												gasLimit,
											});
										});
										it('then their pUSD balance is 4990 + pBTCBalanceAfterExchange', async () => {
											const balance = await callMethodWithRetry(
												pUSDContract.methods.balanceOf(accounts.first.public)
											);
											const { amountReceived } = await callMethodWithRetry(
												Exchanger.methods.getAmountsForExchange(
													pBTCBalanceAfterExchange,
													pBTC,
													pUSD
												)
											);
											assert.strictEqual(
												web3.utils.fromWei(balance),
												(4990 + +web3.utils.fromWei(amountReceived)).toString(),
												'Balance should match'
											);
										});
										it('and their pBTC balance is 0', async () => {
											const balance = await callMethodWithRetry(
												pBTCContract.methods.balanceOf(accounts.first.public)
											);
											assert.strictEqual(web3.utils.fromWei(balance), '0', 'Balance should match');
										});
									});
								});
							});
						});
						describe('pynth suspension', () => {
							let SystemStatus;
							describe('when one pynth has a price well outside of range, triggering price deviation', () => {
								beforeEach(async () => {
									SystemStatus = getContract({ target: 'SystemStatus' });
									await setAggregatorAnswer({ asset: 'ETH', rate: 20 });
								});
								it('when exchange occurs into that pynth, the pynth is suspended', async () => {
									await PeriFinance.methods.exchange(pUSD, web3.utils.toWei('1'), pETH).send({
										from: accounts.first.public,
										gas: gasLimit,
										gasPrice,
									});

									const { suspended, reason } = await SystemStatus.methods
										.pynthsuspension(pETH)
										.call();
									assert.strictEqual(suspended, true);
									assert.strictEqual(reason.toString(), '65');
								});
							});
						});
					});

					describe('handle updates to inverted rates', () => {
						describe('when a user has issued and exchanged into iCEX', () => {
							beforeEach(async () => {
								await PeriFinance.methods.issueMaxPynths().send({
									from: accounts.first.public,
									gas: gasLimit,
									gasPrice,
								});

								await PeriFinance.methods
									.exchange(toBytes32('pUSD'), web3.utils.toWei('100'), toBytes32('iCEX'))
									.send({
										from: accounts.first.public,
										gas: gasLimit,
										gasPrice,
									});
							});
							describe('when a new inverted pynth iABC is added to the list', () => {
								describe('and the inverted pynth iXTZ has its parameters shifted', () => {
									describe('and the inverted pynth iCEX has its parameters shifted as well', () => {
										beforeEach(async () => {
											// read current config file version (if something has been removed,
											// we don't want to include it here)
											const currentPynthsFile = JSON.parse(fs.readFileSync(pynthsJSONPath));

											// add new iABC pynth
											currentPynthsFile.push({
												name: 'iABC',
												asset: 'ABC',
												category: 'crypto',
												sign: '',
												description: 'Inverted Alphabet',
												subclass: 'PurgeablePynth',
												inverted: {
													entryPoint: 1,
													upperLimit: 1.5,
													lowerLimit: 0.5,
												},
											});

											// mutate parameters of iXTZ
											// Note: this is brittle and will *break* if iXTZ or iCEX are removed from the
											// pynths for deployment. This needs to be improved in the near future - JJ
											currentPynthsFile.find(({ name }) => name === 'iXTZ').inverted = {
												entryPoint: 100,
												upperLimit: 150,
												lowerLimit: 50,
											};

											// mutate parameters of iCEX
											currentPynthsFile.find(({ name }) => name === 'iCEX').inverted = {
												entryPoint: 1,
												upperLimit: 1.5,
												lowerLimit: 0.5,
											};

											fs.writeFileSync(pynthsJSONPath, JSON.stringify(currentPynthsFile));
										});

										describe('when ExchangeRates alone is redeployed', () => {
											let ExchangeRates;
											let currentConfigFile;
											beforeEach(async () => {
												// read current config file version (if something has been removed,
												// we don't want to include it here)
												currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
												const configForExrates = Object.keys(currentConfigFile).reduce(
													(memo, cur) => {
														memo[cur] = { deploy: cur === 'ExchangeRates' };
														return memo;
													},
													{}
												);

												fs.writeFileSync(configJSONPath, JSON.stringify(configForExrates));

												await commands.deploy({
													concurrency,
													addNewPynths: true,
													network,
													yes: true,
													privateKey: accounts.deployer.private,
												});
												targets = getTarget();
												ExchangeRates = getContract({ target: 'ExchangeRates' });
											});

											// Test the properties of an inverted pynth
											const testInvertedPynth = async ({
												currencyKey,
												shouldBeFrozenAtUpperLimit,
												shouldBeFrozenAtLowerLimit,
											}) => {
												const {
													entryPoint,
													upperLimit,
													lowerLimit,
													frozenAtUpperLimit,
													frozenAtLowerLimit,
												} = await callMethodWithRetry(
													ExchangeRates.methods.inversePricing(toBytes32(currencyKey))
												);
												const expected = pynths.find(({ name }) => name === currencyKey).inverted;
												assert.strictEqual(
													+web3.utils.fromWei(entryPoint),
													expected.entryPoint,
													'Entry points match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(upperLimit),
													expected.upperLimit,
													'Upper limits match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(lowerLimit),
													expected.lowerLimit,
													'Lower limits match'
												);
												assert.strictEqual(
													frozenAtUpperLimit,
													!!shouldBeFrozenAtUpperLimit,
													'Frozen upper matches expectation'
												);

												assert.strictEqual(
													frozenAtLowerLimit,
													!!shouldBeFrozenAtLowerLimit,
													'Frozen lower matches expectation'
												);
											};

											it('then the new iABC pynth should be added correctly (as it has no previous rate)', async () => {
												const iABC = toBytes32('iABC');
												const {
													entryPoint,
													upperLimit,
													lowerLimit,
													frozenAtUpperLimit,
													frozenAtLowerLimit,
												} = await callMethodWithRetry(ExchangeRates.methods.inversePricing(iABC));
												const rate = await callMethodWithRetry(
													ExchangeRates.methods.rateForCurrency(iABC)
												);

												assert.strictEqual(+web3.utils.fromWei(entryPoint), 1, 'Entry point match');
												assert.strictEqual(
													+web3.utils.fromWei(upperLimit),
													1.5,
													'Upper limit match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(lowerLimit),
													0.5,
													'Lower limit match'
												);
												assert.strictEqual(
													frozenAtUpperLimit || frozenAtLowerLimit,
													false,
													'Is not frozen'
												);
												assert.strictEqual(
													+web3.utils.fromWei(rate),
													0,
													'No rate for new inverted pynth'
												);
											});

											it('and the iXTZ pynth should be reconfigured correctly (as it has 0 total supply)', async () => {
												const iXTZ = toBytes32('iXTZ');
												const {
													entryPoint,
													upperLimit,
													lowerLimit,
													frozenAtUpperLimit,
													frozenAtLowerLimit,
												} = await callMethodWithRetry(ExchangeRates.methods.inversePricing(iXTZ));

												assert.strictEqual(
													+web3.utils.fromWei(entryPoint),
													100,
													'Entry point match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(upperLimit),
													150,
													'Upper limit match'
												);
												assert.strictEqual(
													+web3.utils.fromWei(lowerLimit),
													50,
													'Lower limit match'
												);
												// the old rate (2 x upperLimit) is applied with the new entry point, and
												// as it is very low, when we fetch the rate, it will return at the upper limit,
												// but as freezeRate is a keeper it hasn't been called yet, so it won't return as frozenAtUpper
												assert.strictEqual(
													frozenAtUpperLimit || frozenAtLowerLimit,
													false,
													'Is not frozen'
												);

												// so perform  freeze
												await ExchangeRates.methods.freezeRate(iXTZ).send({
													from: accounts.first.public,
													gas: gasLimit,
													gasPrice,
												});

												const {
													frozenAtUpperLimit: newFrozenAtUpperLimit,
												} = await callMethodWithRetry(ExchangeRates.methods.inversePricing(iXTZ));

												assert.strictEqual(
													newFrozenAtUpperLimit,
													true,
													'Is now frozen at upper limit'
												);
											});

											it('and the iCEX pynth should not be inverted at all', async () => {
												const { entryPoint } = await callMethodWithRetry(
													ExchangeRates.methods.inversePricing(toBytes32('iCEX'))
												);

												assert.strictEqual(
													+web3.utils.fromWei(entryPoint),
													0,
													'iCEX should not be set'
												);
											});

											it('and iDEFI should be set as frozen at the lower limit', async () => {
												await testInvertedPynth({
													currencyKey: 'iDEFI',
													shouldBeFrozenAtLowerLimit: true,
												});
											});
											it('and iTRX should be set as frozen at the upper limit', async () => {
												await testInvertedPynth({
													currencyKey: 'iTRX',
													shouldBeFrozenAtUpperLimit: true,
												});
											});
											it('and iBNB should not be frozen', async () => {
												await testInvertedPynth({
													currencyKey: 'iBNB',
												});
											});

											// Note: this is destructive as it removes the pBTC contracts and thus future calls to deploy will fail
											// Either have this at the end of the entire test script or manage configuration of deploys by passing in
											// files to update rather than a file.
											describe('when deployer invokes remove of iABC', () => {
												beforeEach(async () => {
													await commands.removePynths({
														network,
														yes: true,
														privateKey: accounts.deployer.private,
														pynthsToRemove: ['iABC'],
													});
												});

												describe('when user tries to exchange into iABC', () => {
													it('then it fails', done => {
														PeriFinance.methods
															.exchange(
																toBytes32('iCEX'),
																web3.utils.toWei('1000'),
																toBytes32('iABC')
															)
															.send({
																from: accounts.first.public,
																gas: gasLimit,
																gasPrice,
															})
															.then(() => done('Should not have complete'))
															.catch(() => done());
													});
												});
											});
										});
									});
								});
							});
						});
					});
				});
			});

			describe('when a pricing aggregator exists', () => {
				let mockAggregator;
				beforeEach(async () => {
					mockAggregator = await createMockAggregator();
				});
				describe('when Issuer.anyPynthOrPERIRateIsInvalid() is invoked', () => {
					it('then it returns true as expected', async () => {
						const response = await Issuer.methods.anyPynthOrPERIRateIsInvalid().call();
						assert.strictEqual(response, true, 'anyPynthOrPERIRateIsInvalid must be true');
					});
				});
				describe('when one pynth is configured to have a pricing aggregator', () => {
					beforeEach(async () => {
						const currentFeeds = JSON.parse(fs.readFileSync(feedsJSONPath));

						// mutate parameters of EUR - instructing it to use the mock aggregator as a feed
						currentFeeds['EUR'].feed = mockAggregator.options.address;

						fs.writeFileSync(feedsJSONPath, JSON.stringify(currentFeeds));
					});
					describe('when a deployment with nothing set to deploy fresh is run', () => {
						let ExchangeRates;
						beforeEach(async () => {
							const currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
							const configForExrates = Object.keys(currentConfigFile).reduce((memo, cur) => {
								memo[cur] = { deploy: false };
								return memo;
							}, {});

							fs.writeFileSync(configJSONPath, JSON.stringify(configForExrates));

							await commands.deploy({
								concurrency,
								network,
								yes: true,
								privateKey: accounts.deployer.private,
							});
							targets = getTarget();

							ExchangeRates = getContract({ target: 'ExchangeRates' });
						});
						it('then the aggregator must be set for the pEUR price', async () => {
							const pEURAggregator = await callMethodWithRetry(
								ExchangeRates.methods.aggregators(toBytes32('pEUR'))
							);
							assert.strictEqual(pEURAggregator, mockAggregator.options.address);
						});

						describe('when ExchangeRates has rates for all pynths except the aggregated pynth pEUR', () => {
							beforeEach(async () => {
								// update rates
								const pynthsToUpdate = pynths
									.filter(({ name }) => name !== 'pEUR')
									.concat({ asset: 'PERI', rate: 1 });

								for (const { asset } of pynthsToUpdate) {
									await setAggregatorAnswer({ asset, rate: 1 });
								}
							});
							describe('when Issuer.anyPynthOrPERIRateIsInvalid() is invoked', () => {
								it('then it returns true as pEUR still is', async () => {
									const response = await Issuer.methods.anyPynthOrPERIRateIsInvalid().call();
									assert.strictEqual(response, true, 'anyPynthOrPERIRateIsInvalid must be true');
								});
							});

							describe('when the aggregator has a price', () => {
								const rate = '1.15';
								let newTs;
								beforeEach(async () => {
									newTs = timestamp + 300;
									await mockAggregator.methods
										.setLatestAnswer((rate * 1e8).toFixed(0), newTs)
										.send({
											from: accounts.deployer.public,
											gas: gasLimit,
											gasPrice,
										});
								});
								describe('then the price from exchange rates for that currency key uses the aggregator', () => {
									it('correctly returns the rate', async () => {
										const response = await callMethodWithRetry(
											ExchangeRates.methods.rateForCurrency(toBytes32('pEUR'))
										);
										assert.strictEqual(web3.utils.fromWei(response), rate);
									});
								});

								describe('when Issuer.anyPynthOrPERIRateIsInvalid() is invoked', () => {
									it('then it returns false as expected', async () => {
										const response = await Issuer.methods.anyPynthOrPERIRateIsInvalid().call();
										assert.strictEqual(
											response,
											false,
											'anyPynthOrPERIRateIsInvalid must be false'
										);
									});
								});
							});
						});
					});
				});
			});

			describe('AddressResolver consolidation', () => {
				let ReadProxyAddressResolver;
				beforeEach(async () => {
					ReadProxyAddressResolver = getContract({ target: 'ReadProxyAddressResolver' });
				});
				describe('when the AddressResolver is set to deploy and everything else false', () => {
					beforeEach(async () => {
						const currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
						const configForAddressResolver = Object.keys(currentConfigFile).reduce((memo, cur) => {
							memo[cur] = { deploy: cur === 'AddressResolver' };
							return memo;
						}, {});

						fs.writeFileSync(configJSONPath, JSON.stringify(configForAddressResolver));
					});
					describe('when re-deployed', () => {
						let AddressResolver;
						beforeEach(async () => {
							await commands.deploy({
								concurrency,
								network,
								yes: true,
								privateKey: accounts.deployer.private,
							});
							targets = getTarget();

							AddressResolver = getContract({ target: 'AddressResolver' });
						});
						it('then the read proxy address resolver is updated', async () => {
							assert.strictEqual(
								await ReadProxyAddressResolver.methods.target().call(),
								AddressResolver.options.address
							);
						});
						it('and the resolver has all the addresses inside', async () => {
							const targets = getTarget();

							const responses = await Promise.all(
								[
									'DebtCache',
									'DelegateApprovals',
									'Depot',
									'EtherCollateral',
									'Exchanger',
									'ExchangeRates',
									'ExchangeState',
									'FeePool',
									'FeePoolEternalStorage',
									'FeePoolState',
									'Issuer',
									'Liquidations',
									'RewardEscrow',
									'RewardsDistribution',
									'SupplySchedule',
									'PeriFinance',
									'PeriFinanceEscrow',
									'PeriFinanceState',
									'PynthpETH',
									'PynthpUSD',
									'SystemStatus',
								].map(contractName =>
									callMethodWithRetry(
										AddressResolver.methods.getAddress(peri.toBytes32(contractName))
									).then(found => ({ contractName, ok: found === targets[contractName].address }))
								)
							);

							for (const { contractName, ok } of responses) {
								assert.ok(ok, `${contractName} incorrect in resolver`);
							}
						});
					});
				});
				describe('when Exchanger is marked to deploy, and everything else false', () => {
					beforeEach(async () => {
						const currentConfigFile = JSON.parse(fs.readFileSync(configJSONPath));
						const configForExchanger = Object.keys(currentConfigFile).reduce((memo, cur) => {
							memo[cur] = { deploy: cur === 'Exchanger' };
							return memo;
						}, {});

						fs.writeFileSync(configJSONPath, JSON.stringify(configForExchanger));
					});
					describe('when re-deployed', () => {
						let AddressResolver;
						beforeEach(async () => {
							AddressResolver = getContract({ target: 'AddressResolver' });

							const existingExchanger = await callMethodWithRetry(
								AddressResolver.methods.getAddress(peri.toBytes32('Exchanger'))
							);

							assert.strictEqual(existingExchanger, targets['Exchanger'].address);

							await commands.deploy({
								concurrency,
								network,
								yes: true,
								privateKey: accounts.deployer.private,
							});
						});
						it('then the address resolver has the new Exchanger added to it', async () => {
							const targets = getTarget();

							const actualExchanger = await callMethodWithRetry(
								AddressResolver.methods.getAddress(peri.toBytes32('Exchanger'))
							);

							assert.strictEqual(actualExchanger, targets['Exchanger'].address);
						});
						it('and all have resolver cached correctly', async () => {
							const targets = getTarget();

							const contractsWithResolver = await Promise.all(
								Object.entries(targets)
									// Note: PeriFinanceBridgeToOptimism and PeriFinanceBridgeToBase  have ':' in their deps, instead of hardcoding the
									// address here we should look up all required contracts and ignore any that have
									// ':' in it
									.filter(([contract]) => !/^PeriFinanceBridge/.test(contract))
									.filter(([, { source }]) =>
										sources[source].abi.find(({ name }) => name === 'resolver')
									)
									.map(([contract, { source, address }]) => {
										const Contract = new web3.eth.Contract(sources[source].abi, address);
										return { contract, Contract };
									})
							);

							const readProxyAddress = ReadProxyAddressResolver.options.address;

							for (const { contract, Contract } of contractsWithResolver) {
								const isCached = await callMethodWithRetry(Contract.methods.isResolverCached());
								assert.ok(isCached, `${contract}.isResolverCached() is false!`);
								assert.strictEqual(
									await callMethodWithRetry(Contract.methods.resolver()),
									readProxyAddress,
									`${contract}.resolver is not the ReadProxyAddressResolver`
								);
							}
						});
					});
				});
			});
		});
	});
});
