const { contract } = require('hardhat');
const { ensureOnlyExpectedMutativeFunctions, onlyGivenAddressCanInvoke } = require('./helpers');
const { assert } = require('./common');
const { setupAllContracts } = require('./setup');
const { toUnit } = require('../utils')();
const { toBytes32 } = require('../..');

contract('DebtMigratorOnEthereum', accounts => {
	const [pUSD] = ['pUSD'].map(toBytes32);
	const owner = accounts[1];
	const user = accounts[2];

	let debtMigratorOnEthereum, resolver, rewardEscrowV2, pynths, periFinance, periFinanceDebtShare;

	before(async () => {
		pynths = ['pUSD', 'pETH'];
		({
			AddressResolver: resolver,
			DebtMigratorOnEthereum: debtMigratorOnEthereum,
			RewardEscrowV2: rewardEscrowV2,
			PeriFinance: periFinance,
			PeriFinanceDebtShare: periFinanceDebtShare,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'AddressResolver',
				'DebtMigratorOnEthereum',
				'Issuer',
				// 'Liquidator',
				// 'LiquidatorRewards',
				'RewardEscrowV2',
				'PeriFinance',
				'PeriFinanceBridgeToOptimism',
				'PeriFinanceDebtShare',
				'SystemSettings',
			],
		}));
	});

	it('ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: debtMigratorOnEthereum.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: ['migrateDebt', 'resumeInitiation', 'suspendInitiation'],
		});
	});

	describe('Constructor & Settings', () => {
		it('should set owner on constructor', async () => {
			const ownerAddress = await debtMigratorOnEthereum.owner();
			assert.equal(ownerAddress, owner);
		});

		it('should set resolver on constructor', async () => {
			const resolverAddress = await debtMigratorOnEthereum.resolver();
			assert.equal(resolverAddress, resolver.address);
		});

		it('initiation is not active by default', async () => {
			assert.equal(await debtMigratorOnEthereum.initiationActive(), false);
		});
	});

	describe('suspendInitiation', () => {
		beforeEach(async () => {
			// first resume initiations
			await debtMigratorOnEthereum.resumeInitiation({ from: owner });
		});
		describe('failure modes', () => {
			it('reverts when not invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: debtMigratorOnEthereum.suspendInitiation,
					args: [],
					accounts,
					reason: 'Only the contract owner may perform this action',
					address: owner,
				});
			});

			it('reverts when initiation is already suspended', async () => {
				await debtMigratorOnEthereum.suspendInitiation({ from: owner });

				await assert.revert(
					debtMigratorOnEthereum.suspendInitiation({ from: owner }),
					'Initiation suspended'
				);
			});
		});

		describe('when invoked by the owner', () => {
			let txn;
			beforeEach(async () => {
				txn = await debtMigratorOnEthereum.suspendInitiation({ from: owner });
			});

			it('and initiationActive is false', async () => {
				assert.equal(await debtMigratorOnEthereum.initiationActive(), false);
			});

			it('emits an InitiationSuspended event', async () => {
				assert.eventEqual(txn, 'InitiationSuspended', []);
			});
		});
	});

	describe('resumeInitiation', () => {
		describe('failure modes', () => {
			it('reverts when not invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: debtMigratorOnEthereum.resumeInitiation,
					args: [],
					accounts,
					reason: 'Only the contract owner may perform this action',
					address: owner,
				});
			});

			it('reverts when initiation is not suspended', async () => {
				await assert.revert(
					debtMigratorOnEthereum.resumeInitiation({ from: owner }),
					'Initiation not suspended'
				);
			});
		});

		describe('when invoked by the owner', () => {
			let txn;
			beforeEach(async () => {
				await debtMigratorOnEthereum.suspendInitiation({ from: owner });

				txn = await debtMigratorOnEthereum.resumeInitiation({ from: owner });
			});

			it('initiations are active again', async () => {
				assert.equal(await debtMigratorOnEthereum.initiationActive(), true);
			});

			it('emits an InitiationResumed event', async () => {
				assert.eventEqual(txn, 'InitiationResumed', []);
			});
		});
	});

	describe('when migrating debt', () => {
		let migrateTx;
		let debtTransferSentBefore;
		let liquidPERIBalance, escrowedPERIBalance, debtShareBalance;
		const amountToIssue = toUnit('100');
		const entryAmount = toUnit('50');

		before('create some escrow entries', async () => {
			// allow owner to write to create entries
			await resolver.importAddresses(['FeePool', 'Depot'].map(toBytes32), [owner, owner], {
				from: owner,
			});
			await rewardEscrowV2.rebuildCache();
			await periFinance.transfer(rewardEscrowV2.address, entryAmount, { from: owner });
			await rewardEscrowV2.appendVestingEntry(owner, entryAmount, 1, { from: owner });
		});

		before('issue some debt', async () => {
			await periFinance.issuePynths(PERI, amountToIssue, { from: owner });
		});

		before('record balances', async () => {
			liquidPERIBalance = await periFinance.balanceOf(owner);
			escrowedPERIBalance = await rewardEscrowV2.balanceOf(owner);
			debtShareBalance = await periFinanceDebtShare.balanceOf(owner);
			debtTransferSentBefore = await debtMigratorOnEthereum.debtTransferSent();
		});

		describe('revert cases', () => {
			it('cannot migrate on behalf of another account', async () => {
				await assert.revert(
					debtMigratorOnEthereum.migrateDebt(owner, { from: user }),
					'Must be the account owner'
				);
			});

			it('cannot migrate if initiation is not active', async () => {
				await debtMigratorOnEthereum.suspendInitiation({ from: owner });
				await assert.revert(debtMigratorOnEthereum.migrateDebt(owner, { from: user }));
			});
		});

		describe('succeeds if initiation is active', () => {
			before('resume and invoke the migration', async () => {
				await debtMigratorOnEthereum.resumeInitiation({ from: owner });
				migrateTx = await debtMigratorOnEthereum.migrateDebt(owner, { from: owner });
			});

			it('increments the debt sent counter', async () => {
				const debtTransferSentAfter = await debtMigratorOnEthereum.debtTransferSent();
				assert.bnEqual(debtTransferSentAfter, debtTransferSentBefore.add(debtShareBalance));
			});

			it('zeroes the balances on L1', async () => {
				assert.bnEqual(await periFinance.collateral(owner), 0);
				assert.bnEqual(await periFinance.balanceOf(owner), 0);
				assert.bnEqual(await periFinance.debtBalanceOf(owner, pUSD), 0);
				assert.bnEqual(await rewardEscrowV2.balanceOf(owner), 0);
				assert.bnEqual(await periFinanceDebtShare.balanceOf(owner), 0);
			});

			it('emits a MigrationInitiated event', async () => {
				const migrateEvent = migrateTx.logs[0];
				assert.eventEqual(migrateEvent, 'MigrationInitiated', {
					account: owner,
					totalDebtSharesMigrated: debtShareBalance,
					totalEscrowMigrated: escrowedPERIBalance,
					totalLiquidBalanceMigrated: liquidPERIBalance,
				});
			});
		});
	});
});
