'use strict';

const { artifacts, contract } = require('hardhat');
const { assert, addSnapshotBeforeRestoreAfterEach } = require('../contracts/common');
const { multiplyDecimal, toUnit } = require('../utils')();

const {
	ensureOnlyExpectedMutativeFunctions,
	onlyGivenAddressCanInvoke,
	setupPriceAggregators,
	updateAggregatorRates,
} = require('../contracts/helpers');

const { setupAllContracts } = require('../contracts/setup');
const { toBytes32 } = require('../..');

contract('DynamicPynthRedeemer', async accounts => {
	const pynths = ['pUSD', 'pBTC', 'pETH', 'ETH', 'SNX', 'sLINK'];
	const [pBTC, pETH, ETH, pUSD, SNX, sLINK] = ['pBTC', 'pETH', 'ETH', 'pUSD', 'SNX', 'sLINK'].map(
		toBytes32
	);
	const [priceBTC, priceETH, priceSNX, priceLINK] = ['70000', '3500', '2192', '100'].map(toUnit);

	const [, owner, , , account1] = accounts;

	let instance;
	let addressResolver,
		dynamicPynthRedeemer,
		etherWrapper,
		exchangeRates,
		issuer,
		proxypBTC,
		proxypETH,
		proxypUSD,
		proxysLINK,
		proxyPeriFinance,
		periFinance,
		systemSettings,
		wrapperFactory,
		weth;

	before(async () => {
		({
			AddressResolver: addressResolver,
			DynamicPynthRedeemer: dynamicPynthRedeemer,
			ExchangeRates: exchangeRates,
			Issuer: issuer,
			ProxyERC20pBTC: proxypBTC,
			ProxyERC20pETH: proxypETH,
			ProxyERC20pUSD: proxypUSD,
			ProxyERC20sLINK: proxysLINK,
			ProxyERC20PeriFinance: proxyPeriFinance,
			PeriFinance: periFinance,
			SystemSettings: systemSettings,
			WrapperFactory: wrapperFactory,
			WETH: weth,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'AddressResolver',
				'DebtCache',
				'DynamicPynthRedeemer',
				'Exchanger',
				'ExchangeRates',
				'Issuer',
				'ProxyERC20',
				'RewardEscrowV2',
				'PeriFinance',
				'SystemSettings',
				'WrapperFactory',
				'WETH',
			],
		}));

		// use implementation ABI on the proxy address to simplify calling
		periFinance = await artifacts.require('PeriFinance').at(proxyPeriFinance.address);

		// setup aggregators
		await setupPriceAggregators(exchangeRates, owner, [pBTC, pETH, ETH, SNX, sLINK]);
		await updateAggregatorRates(
			exchangeRates,
			null,
			[pBTC, pETH, ETH, SNX, sLINK],
			[priceBTC, priceETH, priceETH, priceSNX, priceLINK]
		);

		// deploy an eth wrapper
		const etherWrapperCreateTx = await wrapperFactory.createWrapper(
			weth.address,
			pETH,
			toBytes32('PynthpETH'),
			{ from: owner }
		);

		// extract address from events
		const etherWrapperAddress = etherWrapperCreateTx.logs.find(l => l.event === 'WrapperCreated')
			.args.wrapperAddress;
		etherWrapper = await artifacts.require('Wrapper').at(etherWrapperAddress);

		// setup eth wrapper
		await systemSettings.setWrapperMaxTokenAmount(etherWrapperAddress, toUnit('5000'), {
			from: owner,
		});

		// set waiting period to 0
		await systemSettings.setWaitingPeriodSecs(0, {
			from: owner,
		});

		// get some pUSD
		await periFinance.transfer(account1, toUnit('1000'), { from: owner });
		await periFinance.issueMaxPynths({ from: account1 });
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only known functions are mutative', () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: dynamicPynthRedeemer.abi,
			ignoreParents: ['Owned', 'MixinResolver'],
			expected: [
				'redeem',
				'redeemAll',
				'redeemPartial',
				'setDiscountRate',
				'resumeRedemption',
				'suspendRedemption',
			],
		});
	});

	describe('On contract deployment', async () => {
		beforeEach(async () => {
			instance = dynamicPynthRedeemer;
		});

		it('should set constructor params', async () => {
			assert.equal(await instance.owner(), owner);
			assert.equal(await instance.resolver(), addressResolver.address);
		});

		it('should set default discount rate', async () => {
			assert.bnEqual(await instance.getDiscountRate(), toUnit('1'));
		});

		it('should not be active for redemption', async () => {
			assert.equal(await instance.redemptionActive(), false);
		});

		it('should access its dependencies via the address resolver', async () => {
			assert.equal(await addressResolver.getAddress(toBytes32('Issuer')), issuer.address);
			assert.equal(
				await addressResolver.getAddress(toBytes32('ExchangeRates')),
				exchangeRates.address
			);
		});
	});

	describe('suspendRedemption', () => {
		describe('failure modes', () => {
			beforeEach(async () => {
				// first resume redemptions
				await instance.resumeRedemption({ from: owner });
			});

			it('reverts when not invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: instance.suspendRedemption,
					args: [],
					accounts,
					reason: 'Only the contract owner may perform this action',
					address: owner,
				});
			});

			it('reverts when redemption is already suspended', async () => {
				await instance.suspendRedemption({ from: owner });
				await assert.revert(instance.suspendRedemption({ from: owner }), 'Redemption suspended');
			});
		});

		describe('when invoked by the owner', () => {
			let txn;
			beforeEach(async () => {
				// first resume redemptions
				await instance.resumeRedemption({ from: owner });
				txn = await instance.suspendRedemption({ from: owner });
			});

			it('and redemptionActive is false', async () => {
				assert.equal(await instance.redemptionActive(), false);
			});

			it('and a RedemptionSuspended event is emitted', async () => {
				assert.eventEqual(txn, 'RedemptionSuspended', []);
			});
		});
	});

	describe('resumeRedemption', () => {
		describe('failure modes', () => {
			it('reverts when not invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: instance.resumeRedemption,
					args: [],
					accounts,
					reason: 'Only the contract owner may perform this action',
					address: owner,
				});
			});

			it('reverts when redemption is not suspended', async () => {
				await instance.resumeRedemption({ from: owner });
				await assert.revert(instance.resumeRedemption({ from: owner }), 'Redemption not suspended');
			});
		});

		describe('when redemption is suspended', () => {
			it('redemptionActive is false', async () => {
				assert.equal(await instance.redemptionActive(), false);
			});

			describe('when invoked by the owner', () => {
				let txn;
				beforeEach(async () => {
					txn = await instance.resumeRedemption({ from: owner });
				});

				it('redemptions are active again', async () => {
					assert.equal(await instance.redemptionActive(), true);
				});

				it('a RedemptionResumed event is emitted', async () => {
					assert.eventEqual(txn, 'RedemptionResumed', []);
				});
			});
		});
	});

	describe('setDiscountRate()', () => {
		it('may only be called by the owner', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: instance.setDiscountRate,
				args: [toUnit('1.0')],
				accounts,
				address: owner,
				reason: 'Only the contract owner may perform this action',
			});
		});

		it('may not set a rate greater than 1', async () => {
			await assert.revert(
				instance.setDiscountRate(toUnit('1.000001'), { from: owner }),
				'Invalid rate'
			);
		});
	});

	describe('redemption', () => {
		const redeemAmount = toUnit('100.0');
		const exchangeAmount = toUnit('10.0');
		let pBTCBalance, pETHBalance, pUSDBalance, sLINKBalance;

		beforeEach(async () => {
			// first wrap ETH using wrapper to get pETH
			await weth.deposit({ from: account1, value: redeemAmount });
			await weth.approve(etherWrapper.address, redeemAmount, { from: account1 });
			await etherWrapper.mint(redeemAmount, { from: account1 });

			// exchange for some pBTC
			await periFinance.exchange(pETH, exchangeAmount, pBTC, { from: account1 });

			// record balances
			pBTCBalance = await proxypBTC.balanceOf(account1);
			pETHBalance = await proxypETH.balanceOf(account1);
			pUSDBalance = await proxypUSD.balanceOf(account1);
			sLINKBalance = await proxysLINK.balanceOf(account1);
		});

		beforeEach(async () => {
			await instance.resumeRedemption({ from: owner });
		});

		describe('redeem()', () => {
			it('reverts when redemption is suspended', async () => {
				await instance.suspendRedemption({ from: owner });
				await assert.revert(
					instance.redeem(pETH, {
						from: account1,
					}),
					'Redemption deactivated'
				);
			});

			it('reverts when discount rate is set to zero', async () => {
				await instance.setDiscountRate(toUnit('0'), { from: owner });
				await assert.revert(
					instance.redeem(pETH, {
						from: account1,
					}),
					'Pynth not redeemable'
				);
			});

			it('reverts when user has no balance', async () => {
				await assert.revert(
					instance.redeem(sLINK, {
						from: account1,
					}),
					'No balance of pynth to redeem'
				);
			});

			it('reverts when invalid currency key is supplied', async () => {
				await assert.revert(
					instance.redeem(toBytes32('sDeadbeef'), {
						from: account1,
					}),
					'Invalid pynth'
				);
			});

			it('reverts when user attempts to redeem pUSD', async () => {
				assert.bnGt(await proxypUSD.balanceOf(account1), 0);
				await assert.revert(
					instance.redeem(pUSD, {
						from: account1,
					}),
					'Cannot redeem pUSD'
				);
			});

			it('reverts when user attempts to redeem a non-pynth token', async () => {
				await assert.revert(
					instance.redeem(SNX, {
						from: account1,
					})
				);
			});

			describe('when the user has a pynth balance', () => {
				describe('when redeem is called by the user', () => {
					let txn;
					beforeEach(async () => {
						txn = await instance.redeem(pETH, { from: account1 });
					});
					it('emits a PynthRedeemed event', async () => {
						assert.eventEqual(txn, 'PynthRedeemed', {
							pynth: proxypETH.address,
							account: account1,
							amountOfPynth: redeemAmount.sub(exchangeAmount),
							amountInpUSD: toUnit('315000'), // 90 pETH redeemed at price of $3500 is 315,000 pUSD
						});
					});
				});
			});
		});

		describe('redeemAll()', () => {
			it('reverts when redemption is suspended', async () => {
				await instance.suspendRedemption({ from: owner });
				await assert.revert(
					instance.redeemAll([pBTC, pETH], {
						from: account1,
					}),
					'Redemption deactivated'
				);
			});

			it('reverts when neither pynths are redeemable', async () => {
				await updateAggregatorRates(
					exchangeRates,
					null,
					[pBTC, pETH, ETH],
					['0', '0', '0'].map(toUnit)
				);

				await assert.revert(
					instance.redeemAll([pBTC, pETH], {
						from: account1,
					}),
					'Pynth not redeemable'
				);
			});

			describe('when redemption is active', () => {
				describe('when redeemAll is called by the user for both pynths', () => {
					it('reverts when user only has a balance of one pynth', async () => {
						assert.bnGt(pBTCBalance, 0);
						assert.bnEqual(sLINKBalance, 0);
						await assert.revert(
							instance.redeemAll([pBTC, sLINK], {
								from: account1,
							}),
							'No balance of pynth to redeem'
						);
					});
					describe('when user has balances for both pynths', () => {
						let txn;
						beforeEach(async () => {
							txn = await instance.redeemAll([pBTC, pETH], {
								from: account1,
							});
						});

						it('transfers the correct amount of pUSD to the user', async () => {
							assert.bnEqual(await proxypBTC.balanceOf(account1), 0);
							assert.bnEqual(await proxypETH.balanceOf(account1), 0);
							assert.bnEqual(
								await proxypUSD.balanceOf(account1),
								pUSDBalance.add(toUnit('350000')) // 350k pUSD = (90 pETH * 3500) + (0.5 pBTC * 70000)
							);
						});

						it('emits a PynthRedeemed event for each pynth', async () => {
							assert.eventEqual(txn.logs[0], 'PynthRedeemed', {
								pynth: proxypBTC.address,
								account: account1,
								amountOfPynth: pBTCBalance,
								amountInpUSD: multiplyDecimal(pBTCBalance, priceBTC),
							});

							assert.eventEqual(txn.logs[1], 'PynthRedeemed', {
								pynth: proxypETH.address,
								account: account1,
								amountOfPynth: pETHBalance,
								amountInpUSD: multiplyDecimal(pETHBalance, priceETH),
							});
						});
					});
				});
			});
		});

		describe('redeemPartial()', () => {
			const partialAmount = toUnit('25.0');

			it('reverts when redemption is suspended', async () => {
				await instance.suspendRedemption({ from: owner });
				await assert.revert(
					instance.redeemPartial(proxypETH.address, partialAmount, {
						from: account1,
					}),
					'Redemption deactivated'
				);
			});

			describe('when redemption is active', () => {
				describe('when redeemPartial is called by the user', () => {
					beforeEach(async () => {
						pETHBalance = await proxypETH.balanceOf(account1);
					});
					it('reverts when user does not have enough balance', async () => {
						assert.bnEqual(pETHBalance, redeemAmount.sub(exchangeAmount));
						await assert.revert(
							instance.redeemPartial(pETH, redeemAmount, {
								from: account1,
							}),
							'Insufficient balance'
						);
					});
					describe('when user has enough balance', () => {
						let txn;
						beforeEach(async () => {
							txn = await instance.redeemPartial(pETH, partialAmount, {
								from: account1,
							});
						});

						it('burns the correct amount of target pynth from the user', async () => {
							assert.bnEqual(
								await proxypETH.balanceOf(account1),
								redeemAmount.sub(partialAmount).sub(exchangeAmount)
							);
						});

						it('issues the correct amount of pUSD to the user', async () => {
							assert.bnEqual(
								await proxypUSD.balanceOf(account1),
								pUSDBalance.add(toUnit('87500')) // 87.5k pUSD = (25 pETH * 3500)
							);
						});

						it('emits a PynthRedeemed event with the partial amount', async () => {
							assert.eventEqual(txn, 'PynthRedeemed', {
								pynth: proxypETH.address,
								account: account1,
								amountOfPynth: partialAmount,
								amountInpUSD: multiplyDecimal(partialAmount, priceETH),
							});
						});
					});
				});
			});
		});
	});
});
