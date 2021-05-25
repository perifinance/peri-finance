'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { smockit } = require('@eth-optimism/smock');

require('./common'); // import common test scaffolding

const { setupContract, setupAllContracts } = require('./setup');

const { fastForwardTo, toUnit, fromUnit } = require('../utils')();

const {
	ensureOnlyExpectedMutativeFunctions,
	updateRatesWithDefaults,
	setStatus,
} = require('./helpers');

const {
	toBytes32,
	constants: { inflationStartTimestampInSecs },
} = require('../..');

contract('PeriFinance', async accounts => {
	const [pAUD, pEUR] = ['pAUD', 'pEUR'].map(toBytes32);

	const [, owner, account1, account2] = accounts;

	let periFinance,
		exchangeRates,
		debtCache,
		supplySchedule,
		rewardEscrow,
		rewardEscrowV2,
		oracle,
		addressResolver,
		systemStatus;

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
			pynths: ['pUSD', 'pETH', 'pEUR', 'pAUD'],
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
				'StakingStateUSDC',
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
			expected: ['migrateEscrowBalanceToRewardEscrowV2'],
		});
	});

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			const PERI_FINANCE_TOTAL_SUPPLY = web3.utils.toWei('100000000');
			const instance = await setupContract({
				contract: 'PeriFinance',
				accounts,
				skipPostDeploy: true,
				args: [account1, account2, owner, PERI_FINANCE_TOTAL_SUPPLY, addressResolver.address],
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
		const currencyKey1 = pAUD;
		const currencyKey2 = pEUR;
		const trackingCode = toBytes32('1inch');
		const msgSender = owner;

		it('exchangeWithVirtual is called with the right arguments ', async () => {
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

	describe('mint() - inflationary supply minting', async () => {
		// These tests are using values modeled from https://sips.periFinance.io/sips/sip-23
		// https://docs.google.com/spreadsheets/d/1a5r9aFP5bh6wGG4-HIW2MWPf4yMthZvesZOurnG-v_8/edit?ts=5deef2a7#gid=0
		const INITIAL_WEEKLY_SUPPLY = 75e6 / 52;

		const DAY = 86400;
		const WEEK = 604800;

		const INFLATION_START_DATE = inflationStartTimestampInSecs;

		describe('suspension conditions', () => {
			beforeEach(async () => {
				// ensure mint() can succeed by default
				const week234 = INFLATION_START_DATE + WEEK * 234;
				await fastForwardTo(new Date(week234 * 1000));
				await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });
			});
			['System', 'Issuance'].forEach(section => {
				describe(`when ${section} is suspended`, () => {
					beforeEach(async () => {
						await setStatus({ owner, systemStatus, section, suspend: true });
					});
					it('then calling mint() reverts', async () => {
						await assert.revert(periFinance.mint(), 'Operation prohibited');
					});
					describe(`when ${section} is resumed`, () => {
						beforeEach(async () => {
							await setStatus({ owner, systemStatus, section, suspend: false });
						});
						it('then calling mint() succeeds', async () => {
							await periFinance.mint();
						});
					});
				});
			});
		});
		it('should allow periFinance contract to mint inflationary decay for 234 weeks', async () => {
			// fast forward EVM to end of inflation supply decay at week 234
			const week234 = INFLATION_START_DATE + WEEK * 234;
			await fastForwardTo(new Date(week234 * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();
			const mintableSupplyDecimal = parseFloat(fromUnit(mintableSupply));
			const currentRewardEscrowBalance = await periFinance.balanceOf(rewardEscrow.address);

			// Call mint on PeriFinance
			await periFinance.mint();

			const newTotalSupply = await periFinance.totalSupply();
			const newTotalSupplyDecimal = parseFloat(fromUnit(newTotalSupply));
			const minterReward = await supplySchedule.minterReward();

			const expectedEscrowBalance = currentRewardEscrowBalance
				.add(mintableSupply)
				.sub(minterReward);

			// Here we are only checking to 2 decimal places from the excel model referenced above
			// as the precise rounding is not exact but has no effect on the end result to 6 decimals.
			const expectedSupplyToMint = 160387922.86;
			const expectedNewTotalSupply = 260387922.86;
			assert.equal(mintableSupplyDecimal.toFixed(2), expectedSupplyToMint);
			assert.equal(newTotalSupplyDecimal.toFixed(2), expectedNewTotalSupply);

			assert.bnEqual(newTotalSupply, existingSupply.add(mintableSupply));
			assert.bnEqual(await periFinance.balanceOf(rewardEscrowV2.address), expectedEscrowBalance);
		});

		it('should allow periFinance contract to mint 2 weeks of supply and minus minterReward', async () => {
			// Issue
			const supplyToMint = toUnit(INITIAL_WEEKLY_SUPPLY * 2);

			// fast forward EVM to Week 3 in of the inflationary supply
			const weekThree = INFLATION_START_DATE + WEEK * 2 + DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();
			const mintableSupplyDecimal = parseFloat(fromUnit(mintableSupply));
			const currentRewardEscrowBalance = await periFinance.balanceOf(rewardEscrow.address);

			// call mint on PeriFinance
			await periFinance.mint();

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

		it('should allow periFinance contract to mint the same supply for 39 weeks into the inflation prior to decay', async () => {
			// 39 weeks mimics the inflationary supply minted on mainnet
			const expectedTotalSupply = toUnit(1e8 + INITIAL_WEEKLY_SUPPLY * 39);
			const expectedSupplyToMint = toUnit(INITIAL_WEEKLY_SUPPLY * 39);

			// fast forward EVM to Week 2 in Year 3 schedule starting at UNIX 1583971200+
			const weekThirtyNine = INFLATION_START_DATE + WEEK * 39 + DAY;
			await fastForwardTo(new Date(weekThirtyNine * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingTotalSupply = await periFinance.totalSupply();
			const currentRewardEscrowBalance = await periFinance.balanceOf(rewardEscrow.address);
			const mintableSupply = await supplySchedule.mintableSupply();

			// call mint on PeriFinance
			await periFinance.mint();

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

		it('should allow periFinance contract to mint 2 weeks into Terminal Inflation', async () => {
			// fast forward EVM to week 236
			const september142023 = INFLATION_START_DATE + 236 * WEEK + DAY;
			await fastForwardTo(new Date(september142023 * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingTotalSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call mint on PeriFinance
			await periFinance.mint();

			const newTotalSupply = await periFinance.totalSupply();

			const expectedTotalSupply = toUnit('260638356.052421715910204590');
			const expectedSupplyToMint = expectedTotalSupply.sub(existingTotalSupply);

			assert.bnEqual(newTotalSupply, existingTotalSupply.add(expectedSupplyToMint));
			assert.bnEqual(newTotalSupply, expectedTotalSupply);
			assert.bnEqual(mintableSupply, expectedSupplyToMint);
		});

		it('should allow periFinance contract to mint Terminal Inflation to 2030', async () => {
			// fast forward EVM to week 236
			const week573 = INFLATION_START_DATE + 572 * WEEK + DAY;
			await fastForwardTo(new Date(week573 * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			const existingTotalSupply = await periFinance.totalSupply();
			const mintableSupply = await supplySchedule.mintableSupply();

			// call mint on PeriFinance
			await periFinance.mint();

			const newTotalSupply = await periFinance.totalSupply();

			const expectedTotalSupply = toUnit('306320971.934765774167963072');
			const expectedSupplyToMint = expectedTotalSupply.sub(existingTotalSupply);

			assert.bnEqual(newTotalSupply, existingTotalSupply.add(expectedSupplyToMint));
			assert.bnEqual(newTotalSupply, expectedTotalSupply);
			assert.bnEqual(mintableSupply, expectedSupplyToMint);
		});

		it('should be able to mint again after another 7 days period', async () => {
			// fast forward EVM to Week 3 in Year 2 schedule starting at UNIX 1553040000+
			const weekThree = INFLATION_START_DATE + 2 * WEEK + 1 * DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			let existingTotalSupply = await periFinance.totalSupply();
			let mintableSupply = await supplySchedule.mintableSupply();

			// call mint on PeriFinance
			await periFinance.mint();

			let newTotalSupply = await periFinance.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));

			// fast forward EVM to Week 4
			const weekFour = weekThree + 1 * WEEK + 1 * DAY;
			await fastForwardTo(new Date(weekFour * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

			existingTotalSupply = await periFinance.totalSupply();
			mintableSupply = await supplySchedule.mintableSupply();

			// call mint on PeriFinance
			await periFinance.mint();

			newTotalSupply = await periFinance.totalSupply();
			assert.bnEqual(newTotalSupply, existingTotalSupply.add(mintableSupply));
		});

		it('should revert when trying to mint again within the 7 days period', async () => {
			// fast forward EVM to Week 3 of inflation
			const weekThree = INFLATION_START_DATE + 2 * WEEK + DAY;
			await fastForwardTo(new Date(weekThree * 1000));
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

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

	describe('migration - transfer escrow balances to reward escrow v2', () => {
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
