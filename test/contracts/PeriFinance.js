'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

require('./common'); // import common test scaffolding

const { setupContract, setupAllContracts } = require('./setup');

const { fastForwardTo, toUnit, fromUnit, multiplyDecimal, toBigNbr } = require('../utils')();

const {
	ensureOnlyExpectedMutativeFunctions,
	updateRatesWithDefaults,
	setupPriceAggregators,
	setStatus,
} = require('./helpers');

const {
	toBytes32,
	constants: { inflationStartTimestampInSecs },
} = require('../..');

const INITIAL_WEEKLY_SUPPLY = toBigNbr('7692471952706302968912');

const DAY = 86400;
const WEEK = 604800;

const INFLATION_START_DATE = inflationStartTimestampInSecs;

contract('PeriFinance', async accounts => {
	const [pBTC, pETH, pUSD, PERI] = ['pBTC', 'pETH', 'pUSD', 'PERI'].map(toBytes32);

	const [, owner, account1, account2, account3, account4, , , , minterRole] = accounts;

	let periFinance,
		periFinanceProxy,
		exchangeRates,
		debtCache,
		supplySchedule,
		rewardEscrow,
		rewardEscrowV2,
		addressResolver,
		systemStatus,
		pUSDContract,
		pETHContract;

	const cumulativeSupply = (weeks, initailWeeklySupply) => {
			let expectedTotalSupply = toUnit('0');
			for (let i = 0; i <= weeks; i++) {
				if (i < 51) {
					expectedTotalSupply = expectedTotalSupply.add(initailWeeklySupply);
				} else if (i <= 172) {
					const decay = 0.9875 ** (i - 50);
					expectedTotalSupply = expectedTotalSupply.add(
						multiplyDecimal(initailWeeklySupply, toUnit(decay))
					);
				}
			}
	
			return expectedTotalSupply;
		};

	before(async () => {
		({
			PeriFinance: periFinance,
			ProxyERC20PeriFinance: periFinanceProxy,
			AddressResolver: addressResolver,
			ExchangeRates: exchangeRates,
			DebtCache: debtCache,
			SystemStatus: systemStatus,
			RewardEscrowV2: rewardEscrow,
			RewardEscrowV2: rewardEscrowV2,
			SupplySchedule: supplySchedule,
			PynthpUSD: pUSDContract,
			PynthpETH: pETHContract,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD', 'pETH', 'pBTC'],
			contracts: [
				'PeriFinance',
				'SupplySchedule',
				'AddressResolver',
				'ExchangeRates',
				'SystemStatus',
				'DebtCache',
				'Issuer',
				'Exchanger',
				'RewardsDistribution',
				'CollateralManager',
				'RewardEscrowV2', // required for issuer._collateral to read collateral
				'RewardEscrow',
				'StakingState',
				'CrossChainManager',
			],
		}));

		// use implementation ABI on the proxy address to simplify calling
		periFinanceProxy = await artifacts.require('PeriFinance').at(periFinanceProxy.address);

		await setupPriceAggregators(exchangeRates, owner, [pETH]);
	});

	addSnapshotBeforeRestoreAfterEach();

	it.skip('ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: periFinance.abi,
			ignoreParents: ['BasePeriFinance'],
			expected: ['emitAtomicPynthExchange', ],
		});
	});

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			const PERI_FINANCE_TOTAL_SUPPLY = web3.utils.toWei('11000000');
			const instance = await setupContract({
				contract: 'PeriFinance',
				accounts,
				skipPostDeploy: true,
				args: [
					account1,
					account2,
					owner,
					PERI_FINANCE_TOTAL_SUPPLY,
					addressResolver.address,
					account3,
					account4,
					account4,
				],
			});

			assert.equal(await instance.proxy(), account1);
			assert.equal(await instance.tokenState(), account2);
			assert.equal(await instance.owner(), owner);
			assert.equal(await instance.totalSupply(), PERI_FINANCE_TOTAL_SUPPLY);
			assert.equal(await instance.resolver(), addressResolver.address);
		});
	});

	describe('mint() - inflationary supply minting', async () => {

		// Set inflation amount
		beforeEach(async () => {
			await supplySchedule.setMaxInflationAmount(toUnit(INITIAL_WEEKLY_SUPPLY), { from: owner });
			await supplySchedule.setInflationAmount(toUnit(INITIAL_WEEKLY_SUPPLY), { from: owner });
		});
		describe('suspension conditions', () => {
			beforeEach(async () => {
				// ensure mint() can succeed by default
				const week234 = INFLATION_START_DATE + WEEK * 234;
				await fastForwardTo(new Date(week234 * 1000));
				await updateRatesWithDefaults({ exchangeRates, owner, debtCache });
				await supplySchedule.setInflationAmount(toUnit(INITIAL_WEEKLY_SUPPLY), { from: owner });
			});
			['System', 'Issuance'].forEach(section => {
				describe(`when ${section} is suspended`, () => {
					beforeEach(async () => {
						await setStatus({ owner, systemStatus, section, suspend: true });
					});
					it('then calling inflationalMint() reverts', async () => {
						await assert.revert(
							periFinance.inflationalMint({ from: minterRole }),
							'Operation prohibited'
						);
					});
					describe(`when ${section} is resumed`, () => {
						beforeEach(async () => {
							await setStatus({ owner, systemStatus, section, suspend: false });
						});
						it('then calling inflationalMint() succeeds', async () => {
							await periFinance.inflationalMint({ from: minterRole });
						});
					});
				});
			});
		});
		it.skip('should allow periFinance contract to inflationalMint inflationary decay for 172 weeks', async () => {
			// fast forward EVM to end of inflation supply decay at week 173
			const week172 = Number(INFLATION_START_DATE) + Number(WEEK * 172);
			await fastForwardTo(new Date(week172 * 1000));
			await updateRatesWithDefaults({ exchangeRates, owner, debtCache });
			const existingSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();
			const mintableSupplyDecimal = parseFloat(fromUnit(mintableSupply));

			const currentRewardEscrowBalance = await periFinance.balanceOf(rewardEscrow.address);

			// Call inflationalMint on PeriFinance
			await periFinance.inflationalMint({ from: minterRole });

			const newTotalSupply = await periFinance.totalSupply();
			const newTotalSupplyDecimal = parseFloat(fromUnit(newTotalSupply));
			const minterReward = await supplySchedule.minterReward();

			const expectedEscrowBalance = currentRewardEscrowBalance
				.add(mintableSupply)
				.sub(minterReward);

			// Here we are only checking to 2 decimal places from the excel model referenced above
			// as the precise rounding is not exact but has no effect on the end result to 6 decimals.
			const expectedSupplyToMint = cumulativeSupply(172, INITIAL_WEEKLY_SUPPLY);
			const expectedNewTotalSupply = 11000000 + expectedSupplyToMint;
			assert.equal(mintableSupplyDecimal.toFixed(2), expectedSupplyToMint.toString());
			assert.equal(newTotalSupplyDecimal.toFixed(2), expectedNewTotalSupply.toFixed(2));

			assert.bnEqual(newTotalSupply, existingSupply.add(mintableSupply));
			assert.bnEqual(await periFinance.balanceOf(rewardEscrowV2.address), expectedEscrowBalance);
		});

		it.skip('should allow periFinance contract to mint 2 weeks of supply and minus minterReward', async () => {
			// Issue
			const expectedSupplyToMint = toUnit(INITIAL_WEEKLY_SUPPLY * 2);

			// fast forward EVM to Week 3 in of the inflationary supply
			const weekThree = INFLATION_START_DATE + WEEK * 2 + DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, owner, debtCache });

			const existingSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();
			const currentRewardEscrowBalance = await periFinance.balanceOf(rewardEscrow.address);

			// call mint on PeriFinance
			await periFinance.mint();

			const newTotalSupply = await periFinance.totalSupply();

			const minterReward = await supplySchedule.minterReward();
			const expectedEscrowBalance = currentRewardEscrowBalance
				.add(mintableSupply)
				.sub(minterReward);

			// Here we are only checking to 2 decimal places from the excel model referenced above
			const expectedNewTotalSupply = existingSupply.add(expectedSupplyToMint);
			assert.bnEqual(newTotalSupply, expectedNewTotalSupply);

			assert.bnEqual(newTotalSupply, existingSupply.add(mintableSupply));
			assert.bnEqual(await periFinance.balanceOf(rewardEscrowV2.address), expectedEscrowBalance);
		});

		it('should allow periFinance contract to inflationalMint 2 weeks into Terminal Inflation', async () => {
			// fast forward EVM to week 170
			const secondweekBefore = INFLATION_START_DATE + 170 * WEEK + DAY;
			await fastForwardTo(new Date(secondweekBefore * 1000));
			await updateRatesWithDefaults({ exchangeRates, owner, debtCache });

			const existingTotalSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call inflationalMint on PeriFinance
			await periFinance.inflationalMint({ from: minterRole });

			const newTotalSupply = await periFinance.totalSupply();

			const expectedSupplyToMint = cumulativeSupply(170, INITIAL_WEEKLY_SUPPLY);

			const expectedTotalSupply = expectedSupplyToMint.add(existingTotalSupply);

			assert.bnClose(newTotalSupply, existingTotalSupply.add(expectedSupplyToMint), 10000000000);
			assert.bnClose(newTotalSupply, expectedTotalSupply, 10000000000);
			assert.bnClose(mintableSupply, expectedSupplyToMint, 10000000000);
		});
		
		it.skip('should be able to mint again after another 7 days period', async () => {
			// fast forward EVM to Week 3 in Year 2 schedule starting at UNIX 1553040000+
			const weekThree = INFLATION_START_DATE + 2 * WEEK + 1 * DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, owner, debtCache });

			let existingTotalSupply = await periFinance.totalSupply();
			let mintableSupply = await supplySchedule.mintableSupply();

			// call mint on PeriFinance
			await periFinance.mint();

			let newTotalSupply = await periFinance.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));

			// fast forward EVM to Week 4
			const weekFour = weekThree + 1 * WEEK + 1 * DAY;
			await fastForwardTo(new Date(weekFour * 1000));
			await updateRatesWithDefaults({ exchangeRates, owner, debtCache });

			existingTotalSupply = await periFinance.totalSupply();
			mintableSupply = await supplySchedule.mintableSupply();

			// call mint on PeriFinance
			await periFinance.mint();

			newTotalSupply = await periFinance.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));
		});

		it.skip('should revert when trying to mint again within the 7 days period', async () => {
			// fast forward EVM to Week 3 of inflation
			const weekThree = INFLATION_START_DATE + 2 * WEEK + DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, owner, debtCache });

			const existingTotalSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call mint on PeriFinance
			await periFinance.mint();

			const newTotalSupply = await periFinance.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));

			const weekFour = weekThree + DAY * 1;
			await fastForwardTo(new Date(weekFour * 1000));

			// should revert if try to mint again within 7 day period / mintable supply is 0
			await assert.revert(periFinance.mint(), 'No supply is mintable');
		});
	});

	describe('Using a contract to invoke exchangeWithTrackingForInitiator', () => {
		describe('when a third party contract is setup to exchange pynths', () => {
			let contractExample;
			let amountOfpUSD;
			beforeEach(async () => {
				amountOfpUSD = toUnit('100');

				const MockThirdPartyExchangeContract = artifacts.require('MockThirdPartyExchangeContract');

				// create a contract
				contractExample = await MockThirdPartyExchangeContract.new(addressResolver.address);

				// ensure rates are set
				await updateRatesWithDefaults({ exchangeRates, owner, debtCache });

				// issue pUSD from the owner
				await periFinance.issuePynths(PERI, amountOfpUSD, { from: owner });
				// transfer the pUSD to the contract
				await pUSDContract.transfer(contractExample.address, toUnit('100'), { from: owner });
			});

			describe('when Barrie invokes the exchange function on the contract', () => {
				let txn;
				beforeEach(async () => {
					// Barrie has no pETH to start
					assert.equal(await pETHContract.balanceOf(account3), '0');

					txn = await contractExample.exchange(pUSD, amountOfpUSD, pETH, { from: account3 });
				});
				it('then Barrie has the pynths in her account', async () => {
					assert.bnGt(await pETHContract.balanceOf(account3), toUnit('0.01'));
				});
				it('and the contract has none', async () => {
					assert.equal(await pETHContract.balanceOf(contractExample.address), '0');
				});
				it('and the event emitted indicates that Barrie was the destinationAddress', async () => {
					const logs = artifacts.require('PeriFinance').decodeLogs(txn.receipt.rawLogs);
					assert.eventEqual(
						logs.find(log => log.event === 'PynthExchange'),
						'PynthExchange',
						{
							account: contractExample.address,
							fromCurrencyKey: pUSD,
							fromAmount: amountOfpUSD,
							toCurrencyKey: pETH,
							toAddress: account3,
						}
					);
				});
			});
		});
	});
});
