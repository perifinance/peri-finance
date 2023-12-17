'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { smockit } = require('@eth-optimism/smock');

require('./common'); // import common test scaffolding

const { setupContract, setupAllContracts } = require('./setup');

const { fastForwardTo, toUnit, fromUnit, multiplyDecimal, toBigNbr } = require('../utils')();

const {
	ensureOnlyExpectedMutativeFunctions,
	updateRatesWithDefaults,
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
	const [pBTC, pETH] = ['pBTC', 'pETH'].map(toBytes32);

	const [, owner, account1, account2, account3, account4, , , , minterRole] = accounts;

	let periFinance,
		exchangeRates,
		debtCache,
		supplySchedule,
		rewardEscrow,
		rewardEscrowV2,
		oracle,
		addressResolver,
		systemStatus;

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
			AddressResolver: addressResolver,
			ExchangeRates: exchangeRates,
			DebtCache: debtCache,
			SystemStatus: systemStatus,
			RewardEscrow: rewardEscrow,
			RewardEscrowV2: rewardEscrowV2,
			SupplySchedule: supplySchedule,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD', 'pETH', 'pBTC'],
			contracts: [
				'PeriFinance',
				'PeriFinanceState',
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

		// Send a price update to guarantee we're not stale.
		oracle = account1;
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: periFinance.abi,
			ignoreParents: ['BasePeriFinance'],
			expected: [
				'claimAllBridgedAmounts',
				'overchainTransfer',
				// 'setBridgeState',
				'setBridgeValidator',
				'setInflationMinter',
				'setMinterRole',
			],
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

	describe('Exchanger calls', () => {
		let smockExchanger;
		beforeEach(async () => {
			smockExchanger = await smockit(artifacts.require('Exchanger').abi);
			smockExchanger.smocked.exchangeWithVirtual.will.return.with(() => ['1', account1]);
			await addressResolver.importAddresses(
				['Exchanger'].map(toBytes32),
				[smockExchanger.address],
				{ from: owner }
			);
			await periFinance.rebuildCache();
		});

		const amount1 = '10';
		const currencyKey1 = pBTC;
		const currencyKey2 = pETH;
		const trackingCode = toBytes32('1inch');
		const msgSender = owner;

		it.skip('exchangeWithVirtual is called with the right arguments ', async () => {
			await periFinance.exchangeWithVirtual(currencyKey1, amount1, currencyKey2, trackingCode, {
				from: owner,
			});
			assert.equal(smockExchanger.smocked.exchangeWithVirtual.calls[0][0], msgSender);
			assert.equal(smockExchanger.smocked.exchangeWithVirtual.calls[0][1], currencyKey1);
			assert.equal(smockExchanger.smocked.exchangeWithVirtual.calls[0][2].toString(), amount1);
			assert.equal(smockExchanger.smocked.exchangeWithVirtual.calls[0][3], currencyKey2);
			assert.equal(smockExchanger.smocked.exchangeWithVirtual.calls[0][4], msgSender);
			assert.equal(smockExchanger.smocked.exchangeWithVirtual.calls[0][5], trackingCode);
		});
	});

	describe.skip('inflationalMint() - inflationary supply minting', async () => {
		describe('suspension conditions', () => {
			beforeEach(async () => {
				// ensure inflationalMint() can succeed by default
				const week234 = INFLATION_START_DATE + WEEK * 234;
				await fastForwardTo(new Date(week234 * 1000));
				await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });
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
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });
			const existingSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();
			const mintableSupplyDecimal = parseFloat(fromUnit(mintableSupply));
			const currentRewardEscrowBalance = await periFinance.balanceOf(rewardEscrow.address);

			console.log(`existingSupply is ${existingSupply}, mintableSupply is ${mintableSupply}`);

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
			assert.equal(mintableSupplyDecimal.toFixed(2), expectedSupplyToMint);
			assert.equal(newTotalSupplyDecimal.toFixed(2), expectedNewTotalSupply.toFixed(2));

			assert.bnEqual(newTotalSupply, existingSupply.add(mintableSupply));
			assert.bnEqual(await periFinance.balanceOf(rewardEscrowV2.address), expectedEscrowBalance);
		});

		it.skip('should allow periFinance contract to mint 2 weeks of supply and minus minterReward', async () => {
			// Issue
			const supplyToMint = toUnit(INITIAL_WEEKLY_SUPPLY * 2);

			await periFinance.inflationalMint({ from: minterRole });
			const lastMintEvent = await supplySchedule.lastMintEvent();

			// fast forward EVM to Week 3 in of the inflationary supply
			const weekThree = Number(lastMintEvent) + Number(WEEK * 2 + DAY);
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();
			const mintableSupplyDecimal = parseFloat(fromUnit(mintableSupply));
			const currentRewardEscrowBalance = await periFinance.balanceOf(rewardEscrow.address);

			// call inflationalMint on PeriFinance
			await periFinance.inflationalMint({ from: minterRole });

			const newTotalSupply = await periFinance.totalSupply();
			const newTotalSupplyDecimal = parseFloat(fromUnit(newTotalSupply));

			const minterReward = await supplySchedule.minterReward();
			const expectedEscrowBalance = currentRewardEscrowBalance
				.add(mintableSupply)
				.sub(minterReward);

			// Here we are only checking to 2 decimal places from the excel model referenced above
			const expectedSupplyToMintDecimal = parseFloat(fromUnit(supplyToMint));
			const expectedNewTotalSupply = existingSupply.add(supplyToMint);
			const expectedNewTotalSupplyDecimal = parseFloat(fromUnit(expectedNewTotalSupply));
			assert.equal(mintableSupplyDecimal.toFixed(2), expectedSupplyToMintDecimal.toFixed(2));
			assert.equal(newTotalSupplyDecimal.toFixed(2), expectedNewTotalSupplyDecimal.toFixed(2));

			assert.bnEqual(newTotalSupply, existingSupply.add(mintableSupply));
			assert.bnEqual(await periFinance.balanceOf(rewardEscrowV2.address), expectedEscrowBalance);
		});

		it.skip('should allow periFinance contract to mint the same supply for 39 weeks into the inflation prior to decay', async () => {
			// 39 weeks mimics the inflationary supply minted on mainnet
			const expectedTotalSupply = toUnit(1e8 + INITIAL_WEEKLY_SUPPLY * 39);
			const expectedSupplyToMint = toUnit(INITIAL_WEEKLY_SUPPLY * 39);

			await periFinance.inflationalMint({ from: minterRole });
			const lastMintEvent = await supplySchedule.lastMintEvent();

			// fast forward EVM to Week 2 in Year 3 schedule starting at UNIX 1583971200+
			const weekThirtyNine = lastMintEvent + WEEK * 39 + DAY;
			await fastForwardTo(new Date(weekThirtyNine * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingTotalSupply = await periFinance.totalSupply();
			const currentRewardEscrowBalance = await periFinance.balanceOf(rewardEscrow.address);
			const mintableSupply = await supplySchedule.mintableSupply();

			// call inflationalMint on PeriFinance
			await periFinance.inflationalMint({ from: minterRole });

			const newTotalSupply = await periFinance.totalSupply();
			const minterReward = await supplySchedule.minterReward();
			const expectedEscrowBalance = currentRewardEscrowBalance
				.add(expectedSupplyToMint)
				.sub(minterReward);

			// The precision is slightly off using 18 wei. Matches mainnet.
			assert.bnClose(newTotalSupply, expectedTotalSupply, 27);
			assert.bnClose(mintableSupply, expectedSupplyToMint, 27);

			assert.bnClose(newTotalSupply, existingTotalSupply.add(expectedSupplyToMint), 27);
			assert.bnClose(
				await periFinance.balanceOf(rewardEscrowV2.address),
				expectedEscrowBalance,
				27
			);
		});

		it('should allow periFinance contract to inflationalMint 2 weeks into Terminal Inflation', async () => {
			// fast forward EVM to week 170
			const secondweekBefore = INFLATION_START_DATE + 170 * WEEK + DAY;
			await fastForwardTo(new Date(secondweekBefore * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

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

		it('should allow periFinance contract to inflationalMint Terminal Inflation to 2030', async () => {
			// fast forward EVM to week 236
			const week573 = INFLATION_START_DATE + 172 * WEEK + DAY;
			await fastForwardTo(new Date(week573 * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingTotalSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call inflationalMint on PeriFinance
			await periFinance.inflationalMint({ from: minterRole });

			const newTotalSupply = await periFinance.totalSupply();

			const expectedSupplyToMint = cumulativeSupply(172, INITIAL_WEEKLY_SUPPLY);
			const expectedTotalSupply = expectedSupplyToMint.add(existingTotalSupply);

			assert.bnClose(newTotalSupply, existingTotalSupply.add(expectedSupplyToMint), 10000000000);
			assert.bnClose(newTotalSupply, expectedTotalSupply, 10000000000);
			assert.bnClose(mintableSupply, expectedSupplyToMint, 10000000000);
		});

		it.skip('should be able to inflationalMint again after another 7 days period', async () => {
			// fast forward EVM to Week 3 in Year 2 schedule starting at UNIX 1553040000+
			const weekThree = INFLATION_START_DATE + 2 * WEEK + 1 * DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			let existingTotalSupply = await periFinance.totalSupply();
			let mintableSupply = await supplySchedule.mintableSupply();

			// call inflationalMint on PeriFinance
			await periFinance.inflationalMint({ from: minterRole });

			let newTotalSupply = await periFinance.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));

			// fast forward EVM to Week 4
			const weekFour = weekThree + 1 * WEEK + 1 * DAY;
			await fastForwardTo(new Date(weekFour * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			existingTotalSupply = await periFinance.totalSupply();
			mintableSupply = await supplySchedule.mintableSupply();

			// call inflationalMint on PeriFinance
			await periFinance.inflationalMint({ from: minterRole });

			newTotalSupply = await periFinance.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));
		});

		it.skip('should revert when trying to mint again within the 7 days period', async () => {
			// fast forward EVM to Week 3 of inflation
			const weekThree = INFLATION_START_DATE + 2 * WEEK + DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingTotalSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call inflationalMint on PeriFinance
			await periFinance.inflationalMint({ from: minterRole });

			const newTotalSupply = await periFinance.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));

			const weekFour = weekThree + DAY * 1;
			await fastForwardTo(new Date(weekFour * 1000));

			// should revert if try to inflationalMint again within 7 day period / mintable supply is 0
			await assert.revert(
				periFinance.inflationalMint({ from: minterRole }),
				'No supply is mintable'
			);
		});
	});

	describe.skip('migration - transfer escrow balances to reward escrow v2', () => {
		let rewardEscrowBalanceBefore;
		beforeEach(async () => {
			// transfer PERI to rewardEscrow
			await periFinance.transfer(rewardEscrow.address, toUnit('100'), { from: owner });

			rewardEscrowBalanceBefore = await periFinance.balanceOf(rewardEscrow.address);
		});
		it('should revert if called by non-owner account', async () => {
			await assert.revert(
				periFinance.migrateEscrowBalanceToRewardEscrowV2({ from: account1 }),
				'Only the contract owner may perform this action'
			);
		});
		it('should have transferred reward escrow balance to reward escrow v2', async () => {
			// call the migrate function
			await periFinance.migrateEscrowBalanceToRewardEscrowV2({ from: owner });

			// should have transferred balance to rewardEscrowV2
			assert.bnEqual(
				await periFinance.balanceOf(rewardEscrowV2.address),
				rewardEscrowBalanceBefore
			);

			// rewardEscrow should have 0 balance
			assert.bnEqual(await periFinance.balanceOf(rewardEscrow.address), 0);
		});
	});
});
