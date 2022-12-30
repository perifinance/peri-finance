'use strict';

const { contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { setupContract } = require('./setup');

const { toUnit } = require('../utils')();

const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');

contract('PeriFinanceState', async accounts => {
	const [, owner, account1, account2] = accounts;

	let periFinanceState;

	before(async () => {
		periFinanceState = await setupContract({
			accounts,
			contract: 'PeriFinanceState',
		});
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: periFinanceState.abi,
			ignoreParents: ['State', 'LimitedSetup'],
			expected: [
				'setCurrentIssuanceData',
				'clearIssuanceData',
				'incrementTotalIssuerCount',
				'decrementTotalIssuerCount',
				'appendDebtLedgerValue',
			],
		});
	});
	it('should set constructor params on deployment', async () => {
		const instance = await setupContract({
			accounts,
			contract: 'PeriFinanceState',
			args: [account1, account2],
		});

		assert.equal(await instance.owner(), account1);
		assert.equal(await instance.associatedContract(), account2);
	});

	describe('setCurrentIssuanceData()', () => {
		it('should allow the associated contract to setCurrentIssuanceData', async () => {
			await periFinanceState.setAssociatedContract(account1, { from: owner });
			await periFinanceState.setCurrentIssuanceData(account2, toUnit('0.1'), { from: account1 });
		});

		it('should disallow another from setting the setCurrentIssuanceData', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: periFinanceState.setCurrentIssuanceData,
				args: [account2, toUnit('0.1')],
				accounts,
				skipPassCheck: true,
				reason: 'Only the associated contract can perform this action',
			});
		});
	});

	describe('clearIssuanceData()', () => {
		it('should allow the associated contract to clearIssuanceData', async () => {
			await periFinanceState.setAssociatedContract(account1, { from: owner });
			await periFinanceState.setCurrentIssuanceData(account2, toUnit('0.1'), { from: account1 });
			await periFinanceState.clearIssuanceData(account2, { from: account1 });
			assert.bnEqual((await periFinanceState.issuanceData(account2)).initialDebtOwnership, 0);
		});

		it('should disallow another address from calling clearIssuanceData', async () => {
			await periFinanceState.setAssociatedContract(account1, { from: owner });
			await assert.revert(periFinanceState.clearIssuanceData(account2, { from: account2 }));
		});

		it('should disallow another from setting the setCurrentIssuanceData', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: periFinanceState.clearIssuanceData,
				args: [account2],
				accounts,
				skipPassCheck: true,
				reason: 'Only the associated contract can perform this action',
			});
		});
	});

	describe('incrementTotalIssuerCount()', () => {
		it('should allow the associated contract to incrementTotalIssuerCount', async () => {
			await periFinanceState.setAssociatedContract(account1, { from: owner });

			await periFinanceState.incrementTotalIssuerCount({ from: account1 });
			assert.bnEqual(await periFinanceState.totalIssuerCount(), 1);
		});

		it('should disallow another address from calling incrementTotalIssuerCount', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: periFinanceState.incrementTotalIssuerCount,
				accounts,
				args: [],
				skipPassCheck: true,
				reason: 'Only the associated contract can perform this action',
			});
		});
	});

	describe('decrementTotalIssuerCount()', () => {
		it('should allow the associated contract to decrementTotalIssuerCount', async () => {
			await periFinanceState.setAssociatedContract(account1, { from: owner });

			// We need to increment first or we'll overflow on subtracting from zero and revert that way
			await periFinanceState.incrementTotalIssuerCount({ from: account1 });
			await periFinanceState.decrementTotalIssuerCount({ from: account1 });
			assert.bnEqual(await periFinanceState.totalIssuerCount(), 0);
		});

		it('should disallow another address from calling decrementTotalIssuerCount', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: periFinanceState.decrementTotalIssuerCount,
				accounts,
				args: [],
				skipPassCheck: true,
				reason: 'Only the associated contract can perform this action',
			});
		});
	});

	describe('appendDebtLedgerValue()', () => {
		it('should allow the associated contract to appendDebtLedgerValue', async () => {
			await periFinanceState.setAssociatedContract(account1, { from: owner });

			await periFinanceState.appendDebtLedgerValue(toUnit('0.1'), { from: account1 });
			assert.bnEqual(await periFinanceState.lastDebtLedgerEntry(), toUnit('0.1'));
		});

		it('should disallow another address from calling appendDebtLedgerValue', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: periFinanceState.appendDebtLedgerValue,
				accounts,
				args: [toUnit('0.1')],
				skipPassCheck: true,
				reason: 'Only the associated contract can perform this action',
			});
		});
	});

	describe('debtLedgerLength()', () => {
		it('should correctly report debtLedgerLength', async () => {
			await periFinanceState.setAssociatedContract(account1, { from: owner });

			assert.bnEqual(await periFinanceState.debtLedgerLength(), 0);
			await periFinanceState.appendDebtLedgerValue(toUnit('0.1'), { from: account1 });
			assert.bnEqual(await periFinanceState.debtLedgerLength(), 1);
		});
	});

	describe('lastDebtLedgerEntry()', () => {
		it('should correctly report lastDebtLedgerEntry', async () => {
			await periFinanceState.setAssociatedContract(account1, { from: owner });

			// Nothing in the array, so we should revert on invalid opcode
			// await assert.invalidOpcode(periFinanceState.lastDebtLedgerEntry());
			await periFinanceState.appendDebtLedgerValue(toUnit('0.1'), { from: account1 });
			assert.bnEqual(await periFinanceState.lastDebtLedgerEntry(), toUnit('0.1'));
		});
	});

	describe('hasIssued()', () => {
		it('is false by default', async () => {
			assert.equal(await periFinanceState.hasIssued(account2), false);
		});
		describe('when an account has issuance data', () => {
			beforeEach(async () => {
				await periFinanceState.setAssociatedContract(account1, { from: owner });
				await periFinanceState.setCurrentIssuanceData(account2, toUnit('0.1'), { from: account1 });
			});
			it('then hasIssued() is true', async () => {
				assert.equal(await periFinanceState.hasIssued(account2), true);
			});
		});
	});
});
