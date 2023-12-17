'use strict';

const { artifacts, contract } = require('hardhat');

const { assert } = require('./common');

const { onlyGivenAddressCanInvoke, ensureOnlyExpectedMutativeFunctions } = require('./helpers');

const { toBytes32 } = require('../..');

let VirtualPynthIssuer;

contract('VirtualPynthIssuer unit tests', async accounts => {
	const [, owner] = accounts;

	before(async () => {
		VirtualPynthIssuer = artifacts.require('VirtualPynthIssuer');
	});

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: VirtualPynthIssuer.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: ['createVirtualPynth'],
		});
	});

	// When VirtualPynths is implemented, we re-visit the test.
	describe.skip('when a contract is instantiated', () => {
		// ensure all of the behaviors are bound to "this" for sharing test state
		const behaviors = require('./VirtualPynthIssuer.behaviors').call(this, { accounts });

		describe('exchanging', () => {
			describe('exchangeWithVirtual', () => {
				describe('failure modes', () => {
					const args = [owner, toBytes32('pUSD'), '100', toBytes32('pETH'), owner, toBytes32()];

					behaviors.whenInstantiated({ owner }, () => {
						// as we aren't calling as PeriFinance, we need to mock the check for pynths
						behaviors.whenMockedToAllowChecks(() => {
							it('it reverts when called by regular accounts', async () => {
								await onlyGivenAddressCanInvoke({
									fnc: this.instance.exchangeWithVirtual,
									args,
									accounts: accounts.filter(a => a !== this.mocks.PeriFinance.address),
									reason: 'Exchanger: Only periFinance or a pynth contract can perform this action',
									// address: this.mocks.PeriFinance.address (doesnt work as this reverts due to lack of mocking setup)
								});
							});
						});

						behaviors.whenMockedWithExchangeRatesValidity({ valid: false }, () => {
							it('it reverts when either rate is invalid', async () => {
								await assert.revert(
									this.instance.exchangeWithVirtual(
										...args.concat({ from: this.mocks.PeriFinance.address })
									),
									'Src/dest rate invalid or not found'
								);
							});
							behaviors.whenMockedWithExchangeRatesValidity({ valid: true }, () => {
								behaviors.whenMockedWithNoPriorExchangesToSettle(() => {
									behaviors.whenMockedWithUintSystemSetting(
										{ setting: 'waitingPeriodSecs', value: '0' },
										() => {
											behaviors.whenMockedEffectiveRateAsEqual(() => {
												behaviors.whenMockedLastNRates(() => {
													behaviors.whenMockedAPynthToIssueAmdBurn(() => {
														behaviors.whenMockedExchangeStatePersistance(() => {
															it('it reverts trying to create a virtual pynth with no supply', async () => {
																await assert.revert(
																	this.instance.exchangeWithVirtual(
																		owner,
																		toBytes32('pUSD'),
																		'0',
																		toBytes32('pETH'),
																		owner,
																		toBytes32(),
																		{ from: this.mocks.PeriFinance.address }
																	),
																	'Zero amount'
																);
															});
															it('it reverts trying to virtualize into an inverse pynth', async () => {
																await assert.revert(
																	this.instance.exchangeWithVirtual(
																		owner,
																		toBytes32('pUSD'),
																		'100',
																		toBytes32('iETH'),
																		owner,
																		toBytes32(),
																		{ from: this.mocks.PeriFinance.address }
																	),
																	'Cannot virtualize this pynth'
																);
															});
														});
													});
												});
											});
										}
									);
								});
							});
						});
					});
				});

				behaviors.whenInstantiated({ owner }, () => {
					behaviors.whenMockedWithExchangeRatesValidity({ valid: true }, () => {
						behaviors.whenMockedWithNoPriorExchangesToSettle(() => {
							behaviors.whenMockedWithUintSystemSetting(
								{ setting: 'waitingPeriodSecs', value: '0' },
								() => {
									behaviors.whenMockedEffectiveRateAsEqual(() => {
										behaviors.whenMockedLastNRates(() => {
											behaviors.whenMockedAPynthToIssueAmdBurn(() => {
												behaviors.whenMockedExchangeStatePersistance(() => {
													describe('when invoked', () => {
														let txn;
														const amount = '101';
														beforeEach(async () => {
															txn = await this.instance.exchangeWithVirtual(
																owner,
																toBytes32('pUSD'),
																amount,
																toBytes32('pETH'),
																owner,
																toBytes32(),
																{ from: this.mocks.PeriFinance.address }
															);
														});
														it('emits a VirtualPynthCreated event with the correct underlying pynth and amount', async () => {
															assert.eventEqual(txn, 'VirtualPynthCreated', {
																pynth: this.mocks.pynth.smocked.proxy.will.returnValue,
																currencyKey: toBytes32('pETH'),
																amount,
																recipient: owner,
															});
														});
														describe('when interrogating the Virtual Pynths construction params', () => {
															let vPynth;
															beforeEach(async () => {
																const { vPynth: vPynthAddress } = txn.logs.find(
																	({ event }) => event === 'VirtualPynthCreated'
																).args;
																vPynth = await artifacts.require('VirtualPynth').at(vPynthAddress);
															});
															it('the vPynth has the correct pynth', async () => {
																assert.equal(
																	await vPynth.pynth(),
																	this.mocks.pynth.smocked.proxy.will.returnValue
																);
															});
															it('the vPynth has the correct resolver', async () => {
																assert.equal(await vPynth.resolver(), this.resolver.address);
															});
															it('the vPynth has minted the correct amount to the user', async () => {
																assert.equal(await vPynth.totalSupply(), amount);
																assert.equal(await vPynth.balanceOf(owner), amount);
															});
															it('and the pynth has been issued to the vPynth', async () => {
																assert.equal(
																	this.mocks.pynth.smocked.issue.calls[0][0],
																	vPynth.address
																);
																assert.equal(this.mocks.pynth.smocked.issue.calls[0][1], amount);
															});
														});
													});
												});
											});
										});
									});
								}
							);
						});
					});
				});
			});
		});
	});
});
