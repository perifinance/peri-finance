'use strict';

const { artifacts, contract } = require('hardhat');

const { assert } = require('./common');

const SystemStatus = artifacts.require('SystemStatus');

const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');

const { toBytes32 } = require('../..');

contract('SystemStatus', async accounts => {
	const [SYSTEM, ISSUANCE, EXCHANGE, PYNTH_EXCHANGE, PYNTH] = [
		'System',
		'Issuance',
		'Exchange',
		'PynthExchange',
		'Pynth',
	].map(toBytes32);

	const [, owner, account1, account2, account3] = accounts;

	let SUSPENSION_REASON_UPGRADE;
	let systemStatus;

	beforeEach(async () => {
		systemStatus = await SystemStatus.new(owner);
		SUSPENSION_REASON_UPGRADE = (await systemStatus.SUSPENSION_REASON_UPGRADE()).toString();
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: systemStatus.abi,
			ignoreParents: ['Owned'],
			expected: [
				'resumeExchange',
				'resumeIssuance',
				'resumePynth',
				'resumePynths',
				'resumePynthExchange',
				'resumePynthsExchange',
				'resumeSystem',
				'suspendExchange',
				'suspendIssuance',
				'suspendPynth',
				'suspendPynths',
				'suspendPynthExchange',
				'suspendPynthsExchange',
				'suspendSystem',
				'updateAccessControl',
				'updateAccessControls',
			],
		});
	});

	it('not even the owner can suspend', async () => {
		await assert.revert(
			systemStatus.suspendSystem('1', { from: owner }),
			'Restricted to access control list'
		);
		await assert.revert(
			systemStatus.suspendIssuance('1', { from: owner }),
			'Restricted to access control list'
		);
		await assert.revert(
			systemStatus.suspendExchange('1', { from: owner }),
			'Restricted to access control list'
		);
		await assert.revert(
			systemStatus.suspendPynthExchange(toBytes32('pETH'), '1', { from: owner }),
			'Restricted to access control list'
		);
		await assert.revert(
			systemStatus.suspendPynth(toBytes32('pETH'), '1', { from: owner }),
			'Restricted to access control list'
		);
	});

	describe('when the owner is given access to suspend and resume everything', () => {
		beforeEach(async () => {
			await systemStatus.updateAccessControls(
				[SYSTEM, ISSUANCE, EXCHANGE, PYNTH_EXCHANGE, PYNTH],
				[owner, owner, owner, owner, owner],
				[true, true, true, true, true],
				[true, true, true, true, true],
				{ from: owner }
			);
		});
		describe('suspendSystem()', () => {
			let txn;

			it('is not suspended initially', async () => {
				const { suspended, reason } = await systemStatus.systemSuspension();
				assert.equal(suspended, false);
				assert.equal(reason, '0');
			});

			it('and all the require checks succeed', async () => {
				await systemStatus.requireSystemActive();
				await systemStatus.requireIssuanceActive();
				await systemStatus.requirePynthActive(toBytes32('pETH'));
				await systemStatus.requirePynthsActive(toBytes32('pBTC'), toBytes32('pETH'));
			});

			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.suspendSystem,
					accounts,
					address: owner,
					args: ['0'],
					reason: 'Restricted to access control list',
				});
			});
			it('by default isSystemUpgrading() is false', async () => {
				const isSystemUpgrading = await systemStatus.isSystemUpgrading();
				assert.equal(isSystemUpgrading, false);
			});

			describe('when the owner suspends', () => {
				let givenReason;
				beforeEach(async () => {
					givenReason = '3';
					txn = await systemStatus.suspendSystem(givenReason, { from: owner });
				});
				it('it succeeds', async () => {
					const { suspended, reason } = await systemStatus.systemSuspension();
					assert.equal(suspended, true);
					assert.equal(reason, givenReason);
				});
				it('and isSystemUpgrading() is false', async () => {
					const isSystemUpgrading = await systemStatus.isSystemUpgrading();
					assert.equal(isSystemUpgrading, false);
				});
				it('and emits the expected event', async () => {
					assert.eventEqual(txn, 'SystemSuspended', [givenReason]);
				});
				it('and the require checks all revert as expected', async () => {
					const reason = 'PeriFinance is suspended. Operation prohibited';
					await assert.revert(systemStatus.requireSystemActive(), reason);
					await assert.revert(systemStatus.requireIssuanceActive(), reason);
					await assert.revert(systemStatus.requirePynthActive(toBytes32('pETH')), reason);
					await assert.revert(
						systemStatus.requirePynthsActive(toBytes32('pBTC'), toBytes32('pETH')),
						reason
					);
				});
			});

			describe('when the owner adds an address to suspend only', () => {
				beforeEach(async () => {
					await systemStatus.updateAccessControl(SYSTEM, account1, true, false, { from: owner });
				});

				it('other addresses still cannot suspend', async () => {
					await assert.revert(systemStatus.suspendSystem('0', { from: account2 }));
					await assert.revert(
						systemStatus.suspendSystem(SUSPENSION_REASON_UPGRADE, { from: account3 })
					);
				});

				describe('and that address invokes suspend with upgrading', () => {
					beforeEach(async () => {
						txn = await systemStatus.suspendSystem(SUSPENSION_REASON_UPGRADE, { from: account1 });
					});
					it('it succeeds', async () => {
						const { suspended, reason } = await systemStatus.systemSuspension();
						assert.equal(suspended, true);
						assert.equal(reason, SUSPENSION_REASON_UPGRADE);
					});
					it('and emits the expected event', async () => {
						assert.eventEqual(txn, 'SystemSuspended', [SUSPENSION_REASON_UPGRADE]);
					});
					it('and isSystemUpgrading() is true', async () => {
						const isSystemUpgrading = await systemStatus.isSystemUpgrading();
						assert.equal(isSystemUpgrading, true);
					});
					it('and the require checks all revert with system upgrading, as expected', async () => {
						const reason = 'PeriFinance is suspended, upgrade in progress... please stand by';
						await assert.revert(systemStatus.requireSystemActive(), reason);
						await assert.revert(systemStatus.requireIssuanceActive(), reason);
						await assert.revert(systemStatus.requirePynthActive(toBytes32('pETH')), reason);
						await assert.revert(
							systemStatus.requirePynthsActive(toBytes32('pBTC'), toBytes32('pETH')),
							reason
						);
					});
					it('yet that address cannot resume', async () => {
						await assert.revert(
							systemStatus.resumeSystem({ from: account1 }),
							'Restricted to access control list'
						);
					});
					it('nor can it do any other restricted action', async () => {
						await assert.revert(
							systemStatus.updateAccessControl(SYSTEM, account2, true, true, { from: account1 })
						);
						await assert.revert(systemStatus.suspendIssuance('0', { from: account1 }));
						await assert.revert(systemStatus.resumeIssuance({ from: account1 }));
						await assert.revert(
							systemStatus.suspendPynth(toBytes32('pETH'), '0', { from: account1 })
						);
						await assert.revert(systemStatus.resumePynth(toBytes32('pETH'), { from: account1 }));
					});
					it('yet the owner can still resume', async () => {
						await systemStatus.resumeSystem({ from: owner });
					});
				});
			});
		});

		describe('resumeSystem()', () => {
			let txn;
			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.resumeSystem,
					accounts,
					address: owner,
					args: [],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends within the upgrading flag', () => {
				beforeEach(async () => {
					await systemStatus.suspendSystem(SUSPENSION_REASON_UPGRADE, { from: owner });
				});

				describe('when the owner adds an address to resume only', () => {
					beforeEach(async () => {
						await systemStatus.updateAccessControl(SYSTEM, account1, false, true, { from: owner });
					});

					it('other addresses still cannot resume', async () => {
						await assert.revert(
							systemStatus.resumeSystem({ from: account2 }),
							'Restricted to access control list'
						);
						await assert.revert(
							systemStatus.resumeSystem({ from: account3 }),
							'Restricted to access control list'
						);
					});

					describe('and that address invokes resume', () => {
						beforeEach(async () => {
							txn = await systemStatus.resumeSystem({ from: account1 });
						});

						it('it succeeds', async () => {
							const { suspended, reason } = await systemStatus.systemSuspension();
							assert.equal(suspended, false);
							assert.equal(reason, '0');
						});

						it('and emits the expected event with the upgrading flag', async () => {
							assert.eventEqual(txn, 'SystemResumed', [SUSPENSION_REASON_UPGRADE]);
						});

						it('and all the require checks succeed', async () => {
							await systemStatus.requireSystemActive();
							await systemStatus.requireIssuanceActive();
							await systemStatus.requirePynthActive(toBytes32('pETH'));
						});

						it('yet that address cannot suspend', async () => {
							await assert.revert(
								systemStatus.suspendSystem('0', { from: account1 }),
								'Restricted to access control list'
							);
						});

						it('nor can it do any other restricted action', async () => {
							await assert.revert(
								systemStatus.updateAccessControl(SYSTEM, account2, false, true, { from: account1 })
							);
							await assert.revert(
								systemStatus.suspendIssuance(SUSPENSION_REASON_UPGRADE, { from: account1 })
							);
							await assert.revert(systemStatus.resumeIssuance({ from: account1 }));
							await assert.revert(
								systemStatus.suspendPynth(toBytes32('pETH'), '66', { from: account1 })
							);
							await assert.revert(systemStatus.resumePynth(toBytes32('pETH'), { from: account1 }));
						});
					});
				});
			});
		});

		describe('suspendIssuance()', () => {
			let txn;

			it('is not suspended initially', async () => {
				const { suspended, reason } = await systemStatus.issuanceSuspension();
				assert.equal(suspended, false);
				assert.equal(reason, '0');
			});

			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.suspendIssuance,
					accounts,
					address: owner,
					args: ['0'],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				beforeEach(async () => {
					txn = await systemStatus.suspendIssuance('5', { from: owner });
				});
				it('it succeeds', async () => {
					const { suspended, reason } = await systemStatus.issuanceSuspension();
					assert.equal(suspended, true);
					assert.equal(reason, '5');
					assert.eventEqual(txn, 'IssuanceSuspended', ['5']);
				});
			});

			describe('when the owner adds an address to suspend only', () => {
				beforeEach(async () => {
					await systemStatus.updateAccessControl(ISSUANCE, account2, true, false, { from: owner });
				});

				it('other addresses still cannot suspend', async () => {
					await assert.revert(
						systemStatus.suspendIssuance('1', { from: account1 }),
						'Restricted to access control list'
					);
					await assert.revert(
						systemStatus.suspendIssuance('10', { from: account3 }),
						'Restricted to access control list'
					);
				});

				describe('and that address invokes suspend', () => {
					beforeEach(async () => {
						txn = await systemStatus.suspendIssuance('33', { from: account2 });
					});
					it('it succeeds', async () => {
						const { suspended, reason } = await systemStatus.issuanceSuspension();
						assert.equal(suspended, true);
						assert.equal(reason, '33');
					});
					it('and emits the expected event', async () => {
						assert.eventEqual(txn, 'IssuanceSuspended', ['33']);
					});
					it('and the issuance require check reverts as expected', async () => {
						await assert.revert(
							systemStatus.requireIssuanceActive(),
							'Issuance is suspended. Operation prohibited'
						);
					});
					it('but not the others', async () => {
						await systemStatus.requireSystemActive();
						await systemStatus.requirePynthActive(toBytes32('pETH'));
					});
					it('yet that address cannot resume', async () => {
						await assert.revert(
							systemStatus.resumeIssuance({ from: account2 }),
							'Restricted to access control list'
						);
					});
					it('nor can it do any other restricted action', async () => {
						await assert.revert(
							systemStatus.updateAccessControl(SYSTEM, account3, true, true, { from: account3 })
						);
						await assert.revert(
							systemStatus.suspendSystem(SUSPENSION_REASON_UPGRADE, { from: account2 })
						);
						await assert.revert(systemStatus.resumeSystem({ from: account2 }));
						await assert.revert(
							systemStatus.suspendPynth(toBytes32('pETH'), '55', { from: account2 })
						);
						await assert.revert(systemStatus.resumePynth(toBytes32('pETH'), { from: account2 }));
					});
					it('yet the owner can still resume', async () => {
						await systemStatus.resumeIssuance({ from: owner });
					});
				});
			});
		});

		describe('resumeIssuance()', () => {
			let txn;
			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.resumeIssuance,
					accounts,
					address: owner,
					args: [],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				const givenReason = '5';
				beforeEach(async () => {
					await systemStatus.suspendIssuance(givenReason, { from: owner });
				});

				describe('when the owner adds an address to resume only', () => {
					beforeEach(async () => {
						await systemStatus.updateAccessControl(ISSUANCE, account2, false, true, {
							from: owner,
						});
					});

					it('other addresses still cannot resume', async () => {
						await assert.revert(systemStatus.resumeIssuance({ from: account1 }));
						await assert.revert(systemStatus.resumeIssuance({ from: account3 }));
					});

					describe('and that address invokes resume', () => {
						beforeEach(async () => {
							txn = await systemStatus.resumeIssuance({ from: account2 });
						});

						it('it succeeds', async () => {
							const { suspended, reason } = await systemStatus.issuanceSuspension();
							assert.equal(suspended, false);
							assert.equal(reason, '0');
						});

						it('and emits the expected event', async () => {
							assert.eventEqual(txn, 'IssuanceResumed', [givenReason]);
						});

						it('and all the require checks succeed', async () => {
							await systemStatus.requireSystemActive();
							await systemStatus.requireIssuanceActive();
							await systemStatus.requirePynthActive(toBytes32('pETH'));
						});

						it('yet that address cannot suspend', async () => {
							await assert.revert(
								systemStatus.suspendIssuance('1', { from: account2 }),
								'Restricted to access control list'
							);
						});

						it('nor can it do any other restricted action', async () => {
							await assert.revert(
								systemStatus.updateAccessControl(SYSTEM, account3, false, true, { from: account2 })
							);
							await assert.revert(systemStatus.suspendSystem('8', { from: account2 }));
							await assert.revert(systemStatus.resumeSystem({ from: account2 }));
							await assert.revert(
								systemStatus.suspendPynth(toBytes32('pETH'), '5', { from: account2 })
							);
							await assert.revert(systemStatus.resumePynth(toBytes32('pETH'), { from: account2 }));
						});
					});
				});
			});
		});

		describe('suspendExchange()', () => {
			let txn;

			it('is not suspended initially', async () => {
				const { suspended, reason } = await systemStatus.exchangeSuspension();
				assert.equal(suspended, false);
				assert.equal(reason, '0');
			});

			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.suspendExchange,
					accounts,
					address: owner,
					args: ['0'],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				beforeEach(async () => {
					txn = await systemStatus.suspendExchange('5', { from: owner });
				});
				it('it succeeds', async () => {
					const { suspended, reason } = await systemStatus.exchangeSuspension();
					assert.equal(suspended, true);
					assert.equal(reason, '5');
					assert.eventEqual(txn, 'ExchangeSuspended', ['5']);
				});
			});

			describe('when the owner adds an address to suspend only', () => {
				beforeEach(async () => {
					await systemStatus.updateAccessControl(EXCHANGE, account2, true, false, { from: owner });
				});

				it('other addresses still cannot suspend', async () => {
					await assert.revert(
						systemStatus.suspendExchange('1', { from: account1 }),
						'Restricted to access control list'
					);
					await assert.revert(
						systemStatus.suspendExchange('10', { from: account3 }),
						'Restricted to access control list'
					);
				});

				describe('and that address invokes suspend', () => {
					beforeEach(async () => {
						txn = await systemStatus.suspendExchange('33', { from: account2 });
					});
					it('it succeeds', async () => {
						const { suspended, reason } = await systemStatus.exchangeSuspension();
						assert.equal(suspended, true);
						assert.equal(reason, '33');
					});
					it('and emits the expected event', async () => {
						assert.eventEqual(txn, 'ExchangeSuspended', ['33']);
					});
					it('and the exchange require check reverts as expected', async () => {
						await assert.revert(
							systemStatus.requireExchangeActive(),
							'Exchange is suspended. Operation prohibited'
						);
					});
					it('and requireExchangeBetweenPynthsAllowed reverts as expected', async () => {
						await assert.revert(
							systemStatus.requireExchangeBetweenPynthsAllowed(
								toBytes32('pETH'),
								toBytes32('pBTC')
							),
							'Exchange is suspended. Operation prohibited'
						);
					});
					it('but not the others', async () => {
						await systemStatus.requireSystemActive();
						await systemStatus.requirePynthActive(toBytes32('pETH'));
					});

					it('yet that address cannot resume', async () => {
						await assert.revert(
							systemStatus.resumeExchange({ from: account2 }),
							'Restricted to access control list'
						);
					});
					it('nor can it do any other restricted action', async () => {
						await assert.revert(
							systemStatus.updateAccessControl(SYSTEM, account3, true, true, { from: account3 })
						);
						await assert.revert(
							systemStatus.suspendSystem(SUSPENSION_REASON_UPGRADE, { from: account2 })
						);
						await assert.revert(systemStatus.resumeSystem({ from: account2 }));
						await assert.revert(
							systemStatus.suspendPynth(toBytes32('pETH'), '55', { from: account2 })
						);
						await assert.revert(systemStatus.resumePynth(toBytes32('pETH'), { from: account2 }));
					});
					it('yet the owner can still resume', async () => {
						await systemStatus.resumeExchange({ from: owner });
					});
				});
			});
		});

		describe('resumeExchange()', () => {
			let txn;
			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.resumeExchange,
					accounts,
					address: owner,
					args: [],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				const givenReason = '5';
				beforeEach(async () => {
					await systemStatus.suspendExchange(givenReason, { from: owner });
				});

				describe('when the owner adds an address to resume only', () => {
					beforeEach(async () => {
						await systemStatus.updateAccessControl(EXCHANGE, account2, false, true, {
							from: owner,
						});
					});

					it('other addresses still cannot resume', async () => {
						await assert.revert(systemStatus.resumeExchange({ from: account1 }));
						await assert.revert(systemStatus.resumeExchange({ from: account3 }));
					});

					describe('and that address invokes resume', () => {
						beforeEach(async () => {
							txn = await systemStatus.resumeExchange({ from: account2 });
						});

						it('it succeeds', async () => {
							const { suspended, reason } = await systemStatus.exchangeSuspension();
							assert.equal(suspended, false);
							assert.equal(reason, '0');
						});

						it('and emits the expected event', async () => {
							assert.eventEqual(txn, 'ExchangeResumed', [givenReason]);
						});

						it('and all the require checks succeed', async () => {
							await systemStatus.requireSystemActive();
							await systemStatus.requireExchangeActive();
							await systemStatus.requireExchangeBetweenPynthsAllowed(
								toBytes32('pETH'),
								toBytes32('pBTC')
							);
							await systemStatus.requirePynthActive(toBytes32('pETH'));
						});

						it('yet that address cannot suspend', async () => {
							await assert.revert(
								systemStatus.suspendExchange('1', { from: account2 }),
								'Restricted to access control list'
							);
						});

						it('nor can it do any other restricted action', async () => {
							await assert.revert(
								systemStatus.updateAccessControl(SYSTEM, account3, false, true, { from: account2 })
							);
							await assert.revert(systemStatus.suspendSystem('8', { from: account2 }));
							await assert.revert(systemStatus.resumeSystem({ from: account2 }));
							await assert.revert(
								systemStatus.suspendPynth(toBytes32('pETH'), '5', { from: account2 })
							);
							await assert.revert(systemStatus.resumePynth(toBytes32('pETH'), { from: account2 }));
						});
					});
				});
			});
		});

		describe('suspendPynthExchange()', () => {
			let txn;
			const pBTC = toBytes32('pBTC');

			it('is not suspended initially', async () => {
				const { suspended, reason } = await systemStatus.pynthExchangeSuspension(pBTC);
				assert.equal(suspended, false);
				assert.equal(reason, '0');
			});

			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.suspendPynthExchange,
					accounts,
					address: owner,
					args: [pBTC, '0'],
					reason: 'Restricted to access control list',
				});
			});

			it('getPynthExchangeSuspensions(pETH, pBTC, iBTC) is empty', async () => {
				const { exchangeSuspensions, reasons } = await systemStatus.getPynthExchangeSuspensions(
					['pETH', 'pBTC', 'iBTC'].map(toBytes32)
				);
				assert.deepEqual(exchangeSuspensions, [false, false, false]);
				assert.deepEqual(reasons, ['0', '0', '0']);
			});

			describe('when the owner suspends', () => {
				const givenReason = '150';
				beforeEach(async () => {
					txn = await systemStatus.suspendPynthExchange(pBTC, givenReason, { from: owner });
				});
				it('it succeeds', async () => {
					const { suspended, reason } = await systemStatus.pynthExchangeSuspension(pBTC);
					assert.equal(suspended, true);
					assert.equal(reason, givenReason);
					assert.eventEqual(txn, 'PynthExchangeSuspended', [pBTC, reason]);
				});
				it('getPynthExchangeSuspensions(pETH, pBTC, iBTC) returns values for pBTC', async () => {
					const { exchangeSuspensions, reasons } = await systemStatus.getPynthExchangeSuspensions(
						['pETH', 'pBTC', 'iBTC'].map(toBytes32)
					);
					assert.deepEqual(exchangeSuspensions, [false, true, false]);
					assert.deepEqual(reasons, ['0', givenReason, '0']);
				});
			});

			describe('when the owner adds an address to suspend only', () => {
				beforeEach(async () => {
					await systemStatus.updateAccessControl(PYNTH_EXCHANGE, account3, true, false, {
						from: owner,
					});
				});

				it('other addresses still cannot suspend', async () => {
					await assert.revert(
						systemStatus.suspendPynthExchange(pBTC, '4', { from: account1 }),
						'Restricted to access control list'
					);
					await assert.revert(
						systemStatus.suspendPynthExchange(pBTC, '0', { from: account2 }),
						'Restricted to access control list'
					);
				});

				describe('and that address invokes suspend', () => {
					beforeEach(async () => {
						txn = await systemStatus.suspendPynthExchange(pBTC, '3', { from: account3 });
					});
					it('it succeeds', async () => {
						const { suspended, reason } = await systemStatus.pynthExchangeSuspension(pBTC);
						assert.equal(suspended, true);
						assert.equal(reason, '3');
					});
					it('and emits the expected event', async () => {
						assert.eventEqual(txn, 'PynthExchangeSuspended', [pBTC, '3']);
					});
					it('and the pynth require check reverts as expected', async () => {
						await assert.revert(
							systemStatus.requirePynthExchangeActive(pBTC),
							'Pynth exchange suspended. Operation prohibited'
						);
					});
					it('but not the others', async () => {
						await systemStatus.requireSystemActive();
						await systemStatus.requireIssuanceActive();
						await systemStatus.requirePynthActive(pBTC);
						await systemStatus.requirePynthsActive(toBytes32('pETH'), pBTC);
					});
					it('and requireExchangeBetweenPynthsAllowed() reverts if one is the given pynth', async () => {
						const reason = 'Pynth exchange suspended. Operation prohibited';
						await assert.revert(
							systemStatus.requireExchangeBetweenPynthsAllowed(toBytes32('pETH'), pBTC),
							reason
						);
						await assert.revert(
							systemStatus.requireExchangeBetweenPynthsAllowed(pBTC, toBytes32('pTRX')),
							reason
						);
						await systemStatus.requireExchangeBetweenPynthsAllowed(
							toBytes32('pETH'),
							toBytes32('pUSD')
						); // no issues
						await systemStatus.requireExchangeBetweenPynthsAllowed(
							toBytes32('iTRX'),
							toBytes32('iBTC')
						); // no issues
					});
					it('yet that address cannot resume', async () => {
						await assert.revert(
							systemStatus.resumePynthExchange(pBTC, { from: account2 }),
							'Restricted to access control list'
						);
					});

					it('yet the owner can still resume', async () => {
						await systemStatus.resumePynthExchange(pBTC, { from: owner });
					});
				});
			});
		});

		describe('resumePynthExchange()', () => {
			const pBTC = toBytes32('pBTC');

			let txn;
			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.resumePynthExchange,
					accounts,
					address: owner,
					args: [pBTC],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				const givenReason = '55';
				beforeEach(async () => {
					await systemStatus.suspendPynthExchange(pBTC, givenReason, { from: owner });
				});

				describe('when the owner adds an address to resume only', () => {
					beforeEach(async () => {
						await systemStatus.updateAccessControl(PYNTH_EXCHANGE, account3, false, true, {
							from: owner,
						});
					});

					it('other addresses still cannot resume', async () => {
						await assert.revert(systemStatus.resumePynthExchange(pBTC, { from: account1 }));
						await assert.revert(systemStatus.resumePynthExchange(pBTC, { from: account2 }));
					});

					describe('and that address invokes resume', () => {
						beforeEach(async () => {
							txn = await systemStatus.resumePynthExchange(pBTC, { from: account3 });
						});

						it('it succeeds', async () => {
							const { suspended, reason } = await systemStatus.pynthExchangeSuspension(pBTC);
							assert.equal(suspended, false);
							assert.equal(reason, '0');
						});

						it('and emits the expected event', async () => {
							assert.eventEqual(txn, 'PynthExchangeResumed', [pBTC, givenReason]);
						});

						it('and all the require checks succeed', async () => {
							await systemStatus.requireSystemActive();
							await systemStatus.requireIssuanceActive();
							await systemStatus.requireExchangeBetweenPynthsAllowed(toBytes32('pETH'), pBTC);
							await systemStatus.requirePynthActive(pBTC);
							await systemStatus.requirePynthsActive(pBTC, toBytes32('pETH'));
							await systemStatus.requirePynthsActive(toBytes32('pETH'), pBTC);
						});

						it('yet that address cannot suspend', async () => {
							await assert.revert(
								systemStatus.suspendPynthExchange(pBTC, givenReason, { from: account2 }),
								'Restricted to access control list'
							);
						});

						it('getPynthExchangeSuspensions(pETH, pBTC, iBTC) is empty', async () => {
							const {
								exchangeSuspensions,
								reasons,
							} = await systemStatus.getPynthExchangeSuspensions(
								['pETH', 'pBTC', 'iBTC'].map(toBytes32)
							);
							assert.deepEqual(exchangeSuspensions, [false, false, false]);
							assert.deepEqual(reasons, ['0', '0', '0']);
						});
					});
				});
			});
		});

		describe('suspendPynthsExchange()', () => {
			let txn;
			const [pBTC, pETH] = ['pBTC', 'pETH'].map(toBytes32);

			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.suspendPynthsExchange,
					accounts,
					address: owner,
					args: [[pBTC, pETH], '0'],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				const givenReason = '150';
				beforeEach(async () => {
					txn = await systemStatus.suspendPynthsExchange([pBTC, pETH], givenReason, {
						from: owner,
					});
				});
				it('it succeeds for BTC', async () => {
					const { suspended, reason } = await systemStatus.pynthExchangeSuspension(pBTC);
					assert.equal(suspended, true);
					assert.equal(reason, givenReason);
					assert.eventEqual(txn.logs[0], 'PynthExchangeSuspended', [pBTC, reason]);
				});
				it('and for ETH', async () => {
					const { suspended, reason } = await systemStatus.pynthExchangeSuspension(pETH);
					assert.equal(suspended, true);
					assert.equal(reason, givenReason);
					assert.eventEqual(txn.logs[1], 'PynthExchangeSuspended', [pETH, reason]);
				});
				it('getPynthExchangeSuspensions(pETH, pBTC, iBTC) returns values for pETH and pBTC', async () => {
					const { exchangeSuspensions, reasons } = await systemStatus.getPynthExchangeSuspensions(
						['pETH', 'pBTC', 'iBTC'].map(toBytes32)
					);
					assert.deepEqual(exchangeSuspensions, [true, true, false]);
					assert.deepEqual(reasons, [givenReason, givenReason, '0']);
				});
			});
		});

		describe('resumePynthsExchange()', () => {
			let txn;
			const [pBTC, pETH] = ['pBTC', 'pETH'].map(toBytes32);

			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.resumePynthsExchange,
					accounts,
					address: owner,
					args: [[pBTC, pETH]],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				const givenReason = '55';
				beforeEach(async () => {
					await systemStatus.suspendPynthsExchange([pBTC, pETH], givenReason, { from: owner });
				});

				describe('when the owner adds an address to resume only', () => {
					beforeEach(async () => {
						await systemStatus.updateAccessControl(PYNTH_EXCHANGE, account3, false, true, {
							from: owner,
						});
					});

					describe('and that address invokes resume', () => {
						beforeEach(async () => {
							txn = await systemStatus.resumePynthsExchange([pBTC, pETH], { from: account3 });
						});

						it('it succeeds for pBTC', async () => {
							const { suspended, reason } = await systemStatus.pynthExchangeSuspension(pBTC);
							assert.equal(suspended, false);
							assert.equal(reason, '0');
							assert.eventEqual(txn.logs[0], 'PynthExchangeResumed', [pBTC, givenReason]);
						});

						it('and for pETH', async () => {
							const { suspended, reason } = await systemStatus.pynthExchangeSuspension(pETH);
							assert.equal(suspended, false);
							assert.equal(reason, '0');
							assert.eventEqual(txn.logs[1], 'PynthExchangeResumed', [pETH, givenReason]);
						});

						it('and all the require checks succeed', async () => {
							await systemStatus.requireSystemActive();
							await systemStatus.requireIssuanceActive();
							await systemStatus.requireExchangeBetweenPynthsAllowed(pETH, pBTC);
							await systemStatus.requirePynthsActive(pBTC, pETH);
						});
					});
				});
			});
		});

		describe('suspendPynth()', () => {
			let txn;
			const pBTC = toBytes32('pBTC');

			it('is not suspended initially', async () => {
				const { suspended, reason } = await systemStatus.pynthSuspension(pBTC);
				assert.equal(suspended, false);
				assert.equal(reason, '0');
			});

			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.suspendPynth,
					accounts,
					address: owner,
					args: [pBTC, '0'],
					reason: 'Restricted to access control list',
				});
			});

			it('getPynthSuspensions(pETH, pBTC, iBTC) is empty', async () => {
				const { suspensions, reasons } = await systemStatus.getPynthSuspensions(
					['pETH', 'pBTC', 'iBTC'].map(toBytes32)
				);
				assert.deepEqual(suspensions, [false, false, false]);
				assert.deepEqual(reasons, ['0', '0', '0']);
			});

			describe('when the owner suspends', () => {
				const givenReason = '150';
				beforeEach(async () => {
					txn = await systemStatus.suspendPynth(pBTC, givenReason, { from: owner });
				});
				it('it succeeds', async () => {
					const { suspended, reason } = await systemStatus.pynthSuspension(pBTC);
					assert.equal(suspended, true);
					assert.equal(reason, givenReason);
					assert.eventEqual(txn, 'PynthSuspended', [pBTC, reason]);
				});
				it('getPynthSuspensions(pETH, pBTC, iBTC) returns values for pBTC', async () => {
					const { suspensions, reasons } = await systemStatus.getPynthSuspensions(
						['pETH', 'pBTC', 'iBTC'].map(toBytes32)
					);
					assert.deepEqual(suspensions, [false, true, false]);
					assert.deepEqual(reasons, ['0', givenReason, '0']);
				});
			});

			describe('when the owner adds an address to suspend only', () => {
				beforeEach(async () => {
					await systemStatus.updateAccessControl(PYNTH, account3, true, false, { from: owner });
				});

				it('other addresses still cannot suspend', async () => {
					await assert.revert(
						systemStatus.suspendPynth(pBTC, '4', { from: account1 }),
						'Restricted to access control list'
					);
					await assert.revert(
						systemStatus.suspendPynth(pBTC, '0', { from: account2 }),
						'Restricted to access control list'
					);
				});

				describe('and that address invokes suspend', () => {
					beforeEach(async () => {
						txn = await systemStatus.suspendPynth(pBTC, '3', { from: account3 });
					});
					it('it succeeds', async () => {
						const { suspended, reason } = await systemStatus.pynthSuspension(pBTC);
						assert.equal(suspended, true);
						assert.equal(reason, '3');
					});
					it('and emits the expected event', async () => {
						assert.eventEqual(txn, 'PynthSuspended', [pBTC, '3']);
					});
					it('and the pynth require check reverts as expected', async () => {
						await assert.revert(
							systemStatus.requirePynthActive(pBTC),
							'Pynth is suspended. Operation prohibited'
						);
					});
					it('but not the others', async () => {
						await systemStatus.requireSystemActive();
						await systemStatus.requireIssuanceActive();
					});
					it('and requirePynthsActive() reverts if one is the given pynth', async () => {
						const reason = 'Pynth is suspended. Operation prohibited';
						await assert.revert(systemStatus.requirePynthsActive(toBytes32('pETH'), pBTC), reason);
						await assert.revert(systemStatus.requirePynthsActive(pBTC, toBytes32('pTRX')), reason);
						await systemStatus.requirePynthsActive(toBytes32('pETH'), toBytes32('pUSD')); // no issues
						await systemStatus.requirePynthsActive(toBytes32('iTRX'), toBytes32('iBTC')); // no issues
					});
					it('and requireExchangeBetweenPynthsAllowed() reverts if one is the given pynth', async () => {
						const reason = 'Pynth is suspended. Operation prohibited';
						await assert.revert(
							systemStatus.requireExchangeBetweenPynthsAllowed(toBytes32('pETH'), pBTC),
							reason
						);
						await assert.revert(
							systemStatus.requireExchangeBetweenPynthsAllowed(pBTC, toBytes32('pTRX')),
							reason
						);
						await systemStatus.requireExchangeBetweenPynthsAllowed(
							toBytes32('pETH'),
							toBytes32('pUSD')
						); // no issues
						await systemStatus.requireExchangeBetweenPynthsAllowed(
							toBytes32('iTRX'),
							toBytes32('iBTC')
						); // no issues
					});
					it('yet that address cannot resume', async () => {
						await assert.revert(
							systemStatus.resumePynth(pBTC, { from: account2 }),
							'Restricted to access control list'
						);
					});
					it('nor can it do any other restricted action', async () => {
						await assert.revert(
							systemStatus.updateAccessControl(PYNTH, account1, true, true, { from: account3 })
						);
						await assert.revert(systemStatus.suspendSystem('1', { from: account3 }));
						await assert.revert(systemStatus.resumeSystem({ from: account3 }));
						await assert.revert(systemStatus.suspendIssuance('1', { from: account3 }));
						await assert.revert(systemStatus.resumeIssuance({ from: account3 }));
					});
					it('yet the owner can still resume', async () => {
						await systemStatus.resumePynth(pBTC, { from: owner });
					});
				});
			});
		});

		describe('suspendPynths()', () => {
			let txn;
			const [pBTC, pETH] = ['pBTC', 'pETH'].map(toBytes32);

			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.suspendPynths,
					accounts,
					address: owner,
					args: [[pBTC, pETH], '0'],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				const givenReason = '150';
				beforeEach(async () => {
					txn = await systemStatus.suspendPynths([pBTC, pETH], givenReason, { from: owner });
				});
				it('it succeeds for pBTC', async () => {
					const { suspended, reason } = await systemStatus.pynthSuspension(pBTC);
					assert.equal(suspended, true);
					assert.equal(reason, givenReason);
					assert.eventEqual(txn.logs[0], 'PynthSuspended', [pBTC, reason]);
				});
				it('and for pETH', async () => {
					const { suspended, reason } = await systemStatus.pynthSuspension(pETH);
					assert.equal(suspended, true);
					assert.equal(reason, givenReason);
					assert.eventEqual(txn.logs[1], 'PynthSuspended', [pETH, reason]);
				});
				it('getPynthSuspensions(pETH, pBTC, iBTC) returns values for both', async () => {
					const { suspensions, reasons } = await systemStatus.getPynthSuspensions(
						['pETH', 'pBTC', 'iBTC'].map(toBytes32)
					);
					assert.deepEqual(suspensions, [true, true, false]);
					assert.deepEqual(reasons, [givenReason, givenReason, '0']);
				});
			});
		});

		describe('resumePynth()', () => {
			const pBTC = toBytes32('pBTC');

			let txn;
			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.resumePynth,
					accounts,
					address: owner,
					args: [pBTC],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				const givenReason = '55';
				beforeEach(async () => {
					await systemStatus.suspendPynth(pBTC, givenReason, { from: owner });
				});

				describe('when the owner adds an address to resume only', () => {
					beforeEach(async () => {
						await systemStatus.updateAccessControl(PYNTH, account3, false, true, { from: owner });
					});

					it('other addresses still cannot resume', async () => {
						await assert.revert(systemStatus.resumePynth(pBTC, { from: account1 }));
						await assert.revert(systemStatus.resumePynth(pBTC, { from: account2 }));
					});

					describe('and that address invokes resume', () => {
						beforeEach(async () => {
							txn = await systemStatus.resumePynth(pBTC, { from: account3 });
						});

						it('it succeeds', async () => {
							const { suspended, reason } = await systemStatus.pynthSuspension(pBTC);
							assert.equal(suspended, false);
							assert.equal(reason, '0');
						});

						it('and emits the expected event', async () => {
							assert.eventEqual(txn, 'PynthResumed', [pBTC, givenReason]);
						});

						it('and all the require checks succeed', async () => {
							await systemStatus.requireSystemActive();
							await systemStatus.requireIssuanceActive();
							await systemStatus.requirePynthActive(pBTC);
							await systemStatus.requirePynthsActive(pBTC, toBytes32('pETH'));
							await systemStatus.requirePynthsActive(toBytes32('pETH'), pBTC);
						});

						it('yet that address cannot suspend', async () => {
							await assert.revert(
								systemStatus.suspendPynth(pBTC, givenReason, { from: account2 }),
								'Restricted to access control list'
							);
						});

						it('nor can it do any other restricted action', async () => {
							await assert.revert(
								systemStatus.updateAccessControl(SYSTEM, account1, false, true, { from: account3 })
							);
							await assert.revert(systemStatus.suspendSystem('0', { from: account3 }));
							await assert.revert(systemStatus.resumeSystem({ from: account3 }));
							await assert.revert(systemStatus.suspendIssuance('0', { from: account3 }));
							await assert.revert(systemStatus.resumeIssuance({ from: account3 }));
						});

						it('getPynthSuspensions(pETH, pBTC, iBTC) is empty', async () => {
							const { suspensions, reasons } = await systemStatus.getPynthSuspensions(
								['pETH', 'pBTC', 'iBTC'].map(toBytes32)
							);
							assert.deepEqual(suspensions, [false, false, false]);
							assert.deepEqual(reasons, ['0', '0', '0']);
						});
					});
				});
			});
		});

		describe('resumePynths()', () => {
			const [pBTC, pETH] = ['pBTC', 'pETH'].map(toBytes32);

			let txn;
			it('can only be invoked by the owner initially', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.resumePynths,
					accounts,
					address: owner,
					args: [[pBTC, pETH]],
					reason: 'Restricted to access control list',
				});
			});

			describe('when the owner suspends', () => {
				const givenReason = '55';
				beforeEach(async () => {
					await systemStatus.suspendPynths([pBTC, pETH], givenReason, { from: owner });
				});

				describe('when the owner adds an address to resume only', () => {
					beforeEach(async () => {
						await systemStatus.updateAccessControl(PYNTH, account3, false, true, { from: owner });
					});

					it('other addresses still cannot resume', async () => {
						await assert.revert(systemStatus.resumePynths([pBTC], { from: account1 }));
						await assert.revert(systemStatus.resumePynths([pBTC], { from: account2 }));
					});

					describe('and that address invokes resume', () => {
						beforeEach(async () => {
							txn = await systemStatus.resumePynths([pBTC, pETH], { from: account3 });
						});

						it('it succeeds for pBTC', async () => {
							const { suspended, reason } = await systemStatus.pynthSuspension(pBTC);
							assert.equal(suspended, false);
							assert.equal(reason, '0');
							assert.eventEqual(txn.logs[0], 'PynthResumed', [pBTC, givenReason]);
						});

						it('and for pETH', async () => {
							const { suspended, reason } = await systemStatus.pynthSuspension(pETH);
							assert.equal(suspended, false);
							assert.equal(reason, '0');
							assert.eventEqual(txn.logs[1], 'PynthResumed', [pETH, givenReason]);
						});

						it('getPynthSuspensions(pETH, pBTC, iBTC) is empty', async () => {
							const { suspensions, reasons } = await systemStatus.getPynthSuspensions(
								['pETH', 'pBTC', 'iBTC'].map(toBytes32)
							);
							assert.deepEqual(suspensions, [false, false, false]);
							assert.deepEqual(reasons, ['0', '0', '0']);
						});
					});
				});
			});
		});

		describe('updateAccessControl()', () => {
			const pynth = toBytes32('pETH');

			it('can only be invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.updateAccessControl,
					accounts,
					address: owner,
					args: [SYSTEM, account1, true, false],
					reason: 'Only the contract owner may perform this action',
				});
			});

			it('when invoked with an invalid section, it reverts', async () => {
				await assert.revert(
					systemStatus.updateAccessControl(toBytes32('test'), account1, false, true, {
						from: owner,
					}),
					'Invalid section supplied'
				);
			});

			describe('when invoked by the owner', () => {
				let txn;
				beforeEach(async () => {
					txn = await systemStatus.updateAccessControl(PYNTH, account3, true, false, {
						from: owner,
					});
				});

				it('then it emits the expected event', () => {
					assert.eventEqual(txn, 'AccessControlUpdated', [PYNTH, account3, true, false]);
				});

				it('and the user can perform the action', async () => {
					await systemStatus.suspendPynth(pynth, '1', { from: account3 }); // succeeds without revert
				});

				it('but not the other', async () => {
					await assert.revert(
						systemStatus.resumePynth(pynth, { from: account3 }),
						'Restricted to access control list'
					);
				});

				describe('when overridden for the same user', () => {
					beforeEach(async () => {
						txn = await systemStatus.updateAccessControl(PYNTH, account3, false, false, {
							from: owner,
						});
					});

					it('then it emits the expected event', () => {
						assert.eventEqual(txn, 'AccessControlUpdated', [PYNTH, account3, false, false]);
					});

					it('and the user cannot perform the action', async () => {
						await assert.revert(
							systemStatus.suspendPynth(pynth, '1', { from: account3 }),
							'Restricted to access control list'
						);
					});
				});
			});
		});

		describe('updateAccessControls()', () => {
			it('can only be invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: systemStatus.updateAccessControls,
					accounts,
					address: owner,
					args: [[SYSTEM], [account1], [true], [true]],
					reason: 'Only the contract owner may perform this action',
				});
			});

			it('when invoked with an invalid section, it reverts', async () => {
				await assert.revert(
					systemStatus.updateAccessControls(
						[PYNTH, toBytes32('test')],
						[account1, account2],
						[true, true],
						[false, true],
						{
							from: owner,
						}
					),
					'Invalid section supplied'
				);
			});

			it('when invoked with invalid lengths, it reverts', async () => {
				await assert.revert(
					systemStatus.updateAccessControls([PYNTH], [account1, account2], [true], [false, true], {
						from: owner,
					}),
					'Input array lengths must match'
				);
			});

			describe('when invoked by the owner', () => {
				let txn;
				const pynth = toBytes32('pETH');
				beforeEach(async () => {
					txn = await systemStatus.updateAccessControls(
						[SYSTEM, PYNTH_EXCHANGE, PYNTH],
						[account1, account2, account3],
						[true, false, true],
						[false, true, true],
						{ from: owner }
					);
				});

				it('then it emits the expected events', () => {
					assert.eventEqual(txn.logs[0], 'AccessControlUpdated', [SYSTEM, account1, true, false]);
					assert.eventEqual(txn.logs[1], 'AccessControlUpdated', [
						PYNTH_EXCHANGE,
						account2,
						false,
						true,
					]);
					assert.eventEqual(txn.logs[2], 'AccessControlUpdated', [PYNTH, account3, true, true]);
				});

				it('and the users can perform the actions given', async () => {
					await systemStatus.suspendSystem('3', { from: account1 }); // succeeds without revert
					await systemStatus.resumePynthExchange(pynth, { from: account2 }); // succeeds without revert
					await systemStatus.suspendPynth(pynth, '100', { from: account3 }); // succeeds without revert
					await systemStatus.resumePynth(pynth, { from: account3 }); // succeeds without revert
				});

				it('but not the others', async () => {
					await assert.revert(
						systemStatus.resumeSystem({ from: account1 }),
						'Restricted to access control list'
					);
					await assert.revert(
						systemStatus.resumeSystem({ from: account2 }),
						'Restricted to access control list'
					);
					await assert.revert(
						systemStatus.suspendPynthExchange(pynth, '9', { from: account1 }),
						'Restricted to access control list'
					);
					await assert.revert(
						systemStatus.suspendPynthExchange(pynth, '9', { from: account2 }),
						'Restricted to access control list'
					);
				});
			});
		});
	});
});
