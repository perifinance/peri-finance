const { artifacts, contract, web3 } = require('hardhat');
const { ensureOnlyExpectedMutativeFunctions } = require('./helpers');
const { assert } = require('./common');
const { setupAllContracts } = require('./setup');
const { toBytes32 } = require('../..');
const { currentTime, multiplyDecimalRound, toUnit } = require('../utils')();
const { smock } = require('@defi-wonderland/smock');

contract('DebtMigratorOnOptimism', accounts => {
	const owner = accounts[1];
	const user = accounts[2];
	const mockMessenger = accounts[3];
	const mockL1Migrator = accounts[4];
	const mockedPayloadData = '0xdeadbeef';

	let debtMigratorOnOptimism,
		flexibleStorage,
		messenger,
		resolver,
		periFinance,
		periFinanceDebtShare,
		rewardEscrowV2;

	const getDataOfEncodedFncCall = ({ c, fnc, args = [] }) =>
		web3.eth.abi.encodeFunctionCall(
			artifacts.require(c).abi.find(({ name }) => name === fnc),
			args
		);

	before(async () => {
		({
			AddressResolver: resolver,
			DebtMigratorOnOptimism: debtMigratorOnOptimism,
			FlexibleStorage: flexibleStorage,
			PeriFinance: periFinance,
			PeriFinanceDebtShare: periFinanceDebtShare,
			RewardEscrowV2: rewardEscrowV2,
		} = await setupAllContracts({
			accounts,
			contracts: [
				'AddressResolver',
				'DebtMigratorOnOptimism',
				'FlexibleStorage',
				'Issuer',
				'RewardEscrowV2',
				'PeriFinance',
				'SystemSettings',
			],
		}));

		messenger = await smock.fake('iOVM_BaseCrossDomainMessenger', {
			address: mockMessenger,
		});

		await resolver.importAddresses(
			['ext:Messenger', 'base:DebtMigratorOnEthereum', 'FlexibleStorage'].map(toBytes32),
			[mockMessenger, mockL1Migrator, flexibleStorage.address],
			{
				from: owner,
			}
		);
		await debtMigratorOnOptimism.rebuildCache({ from: owner });
	});

	it('ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: debtMigratorOnOptimism.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: ['finalizeDebtMigration'],
		});
	});

	describe('Constructor & Settings', () => {
		it('should set owner on constructor', async () => {
			const ownerAddress = await debtMigratorOnOptimism.owner();
			assert.equal(ownerAddress, owner);
		});

		it('should set resolver on constructor', async () => {
			const resolverAddress = await debtMigratorOnOptimism.resolver();
			assert.equal(resolverAddress, resolver.address);
		});
	});

	describe('failure modes', () => {
		beforeEach(async () => {
			messenger.xDomainMessageSender.returns(() => owner);
		});

		describe('should only allow the relayer (aka messenger) to call finalizeDebtMigration', () => {
			it('reverts with the expected error', async () => {
				await assert.revert(
					debtMigratorOnOptimism.finalizeDebtMigration(
						user, // Any address
						0,
						0,
						0,
						mockedPayloadData, // Any data
						{ from: owner }
					),
					'Sender is not the messenger'
				);
			});
		});

		describe('should only allow the L1 migrator to invoke finalizeDebtMigration() via the messenger', () => {
			it('reverts with the expected error', async () => {
				await assert.revert(
					debtMigratorOnOptimism.finalizeDebtMigration(
						user, // Any address
						1,
						1,
						1,
						mockedPayloadData, // Any data
						{ from: mockMessenger }
					),
					'L1 sender is not the debt migrator'
				);
			});
		});
	});

	describe('when invoked by the L1 Migrator', () => {
		let migrationFinalizedTx;
		let expectedDebtData;
		let liquidPERIBalanceBefore, escrowedPERIBalanceBefore, debtShareBalanceBefore;
		const liquidPERIAmount = toUnit('500');
		const debtShareAmount = toUnit('100');
		const escrowAmount = toUnit('66.123456789012345678');
		before(async () => {
			// Make sure the migrator has enough PERI
			await resolver.importAddresses(['Depot'].map(toBytes32), [owner], {
				from: owner,
			});
			await periFinance.transfer(debtMigratorOnOptimism.address, escrowAmount.add(liquidPERIAmount), {
				from: owner,
			});
		});

		beforeEach(async () => {
			messenger.xDomainMessageSender.returns(() => mockL1Migrator);

			expectedDebtData = getDataOfEncodedFncCall({
				c: 'Issuer',
				fnc: 'modifyDebtSharesForMigration',
				args: [user, debtShareAmount],
			});
		});

		before('record balances', async () => {
			liquidPERIBalanceBefore = await periFinance.balanceOf(user);
			escrowedPERIBalanceBefore = await rewardEscrowV2.balanceOf(user);
			debtShareBalanceBefore = await periFinanceDebtShare.balanceOf(user);
		});

		before('set permitted escrow creator', async () => {
			await rewardEscrowV2.setPermittedEscrowCreator(debtMigratorOnOptimism.address, true, {
				from: owner,
			});
		});

		it('succeeds', async () => {
			migrationFinalizedTx = await debtMigratorOnOptimism.finalizeDebtMigration(
				user,
				debtShareAmount,
				escrowAmount,
				liquidPERIAmount,
				expectedDebtData,
				{ from: mockMessenger }
			);
		});

		it('increments the debt received counter', async () => {
			const debtTransferSentAfter = await debtMigratorOnOptimism.debtTransferReceived();
			assert.bnEqual(debtTransferSentAfter, debtShareAmount);
		});

		it('emits a MigrationFinalized event', async () => {
			const migrateEvent = migrationFinalizedTx.logs[0];
			assert.eventEqual(migrateEvent, 'MigrationFinalized', {
				account: user,
				totalDebtSharesMigrated: debtShareAmount,
				totalEscrowMigrated: escrowAmount,
				totalLiquidBalanceMigrated: liquidPERIAmount,
			});
		});

		it('updates the L2 state', async () => {
			// updates balances
			const liquidPERIBalanceAfter = await periFinance.balanceOf(user);
			const escrowedPERIBalanceAfter = await rewardEscrowV2.balanceOf(user);
			const debtShareBalanceAfter = await periFinanceDebtShare.balanceOf(user);
			assert.bnEqual(liquidPERIBalanceAfter, liquidPERIBalanceBefore.add(liquidPERIAmount));
			assert.bnEqual(debtShareBalanceAfter, debtShareBalanceBefore.add(debtShareAmount));
			assert.bnEqual(escrowedPERIBalanceAfter, escrowedPERIBalanceBefore.add(escrowAmount));

			// it creates ten escrow entries whose sum equals the total migrated escrow amount
			const now = await currentTime();
			const fourWeeks = 2419200;
			const expectedNumEntries = 10;
			const roundingVariance = toUnit('100');
			assert.bnEqual(await rewardEscrowV2.numVestingEntries(user), expectedNumEntries);
			assert.bnEqual(await rewardEscrowV2.totalEscrowedAccountBalance(user), escrowAmount);

			for (let i = 0; i < expectedNumEntries; i++) {
				assert.bnClose(
					(await rewardEscrowV2.getVestingSchedules(user, i, 1))[0].escrowAmount,
					multiplyDecimalRound(escrowAmount, toUnit('0.1')),
					roundingVariance
				);

				// check escrow entry endTimes are offset by the expected amounts (vest every 4 weeks, with initial 8 week cliff)
				const endTime = (await rewardEscrowV2.getVestingSchedules(user, i, 1))[0].endTime;
				assert.equal(endTime, now + fourWeeks * (2 + i));
			}
		});
	});
});
