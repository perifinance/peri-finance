'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { smockit } = require('@eth-optimism/smock');

require('./common'); // import common test scaffolding

const { setupContract, setupAllContracts } = require('./setup');

const { currentTime, fastForward, toUnit } = require('../utils')();

const {
	ensureOnlyExpectedMutativeFunctions,
	onlyGivenAddressCanInvoke,
	updateRatesWithDefaults,
	setStatus,
} = require('./helpers');

const { toBytes32 } = require('../..');

contract('BasePeriFinance', async accounts => {
	const [pUSD, pAUD, pEUR, PERI, pETH] = ['pUSD', 'pAUD', 'pEUR', 'PERI', 'pETH'].map(toBytes32);

	const [, owner, account1, account2, account3, , , , , minterRole] = accounts;

	let basePeriFinance,
		exchangeRates,
		debtCache,
		escrow,
		oracle,
		// timestamp,
		addressResolver,
		systemSettings,
		systemStatus,
		blacklistManager,
		crossChainManager;

	before(async () => {
		({
			PeriFinance: basePeriFinance,
			AddressResolver: addressResolver,
			ExchangeRates: exchangeRates,
			SystemSettings: systemSettings,
			DebtCache: debtCache,
			SystemStatus: systemStatus,
			PeriFinanceEscrow: escrow,
			CrossChainManager: crossChainManager,
			BlacklistManager: blacklistManager,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD', 'pETH', 'pEUR', 'pAUD'],
			contracts: [
				'PeriFinance',
				'PeriFinanceState',
				'SupplySchedule',
				'AddressResolver',
				'ExchangeRates',
				'SystemSettings',
				'SystemStatus',
				'DebtCache',
				'Issuer',
				'Exchanger',
				'RewardsDistribution',
				'CollateralManager',
				'RewardEscrowV2', // required for collateral check in issuer
				'StakingStateUSDC',
				'StakingState',
				'CrossChainManager',
				'BlacklistManager',
			],
		}));

		// Send a price update to guarantee we're not stale.
		oracle = account1;
		// timestamp = await currentTime();
	});

	addSnapshotBeforeRestoreAfterEach();

	it('ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: basePeriFinance.abi,
			ignoreParents: ['ExternStateToken', 'MixinResolver'],
			expected: [
				'burnPynths',
				'burnSecondary',
				'claimAllBridgedAmounts',
				'emitPynthExchange',
				'emitExchangeRebate',
				'emitExchangeReclaim',
				'emitExchangeTracking',
				'exchange',
				'exchangeOnBehalf',
				'exchangeOnBehalfWithTracking',
				'exchangeWithTracking',
				'exchangeWithVirtual',
				'exit',
				'fitToClaimable',
				'forceFitToClaimable',
				'inflationalMint',
				'issueMaxPynths',
				'issuePynths',
				'issuePynthsToMaxQuota',
				'liquidateDelinquentAccount',
				'mint',
				'mintSecondary',
				'mintSecondaryRewards',
				'overchainTransfer',
				'setBlacklistManager',
				// 'setBridgeState',
				'setBridgeValidator',
				'setInflationMinter',
				'setMinterRole',
				'settle',
				'transfer',
				'transferFrom',
			],
		});
	});

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			const PERI_FINANCE_TOTAL_SUPPLY = web3.utils.toWei('100000000');
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
					owner,
					blacklistManager.address,
					crossChainManager.address,
				],
			});

			assert.equal(await instance.proxy(), account1);
			assert.equal(await instance.tokenState(), account2);
			assert.equal(await instance.owner(), owner);
			assert.equal(await instance.totalSupply(), PERI_FINANCE_TOTAL_SUPPLY);
			assert.equal(await instance.resolver(), addressResolver.address);
		});

		it('should set constructor params on upgrade to new totalSupply', async () => {
			const YEAR_2_PERI_FINANCE_TOTAL_SUPPLY = web3.utils.toWei('175000000');
			const instance = await setupContract({
				contract: 'PeriFinance',
				accounts,
				skipPostDeploy: true,
				args: [
					account1,
					account2,
					owner,
					YEAR_2_PERI_FINANCE_TOTAL_SUPPLY,
					addressResolver.address,
					owner,
					blacklistManager.address,
					crossChainManager.address,
				],
			});

			assert.equal(await instance.proxy(), account1);
			assert.equal(await instance.tokenState(), account2);
			assert.equal(await instance.owner(), owner);
			assert.equal(await instance.totalSupply(), YEAR_2_PERI_FINANCE_TOTAL_SUPPLY);
			assert.equal(await instance.resolver(), addressResolver.address);
		});
	});

	describe('non-basic functions always revert', () => {
		const amount = 100;
		it('ExchangeWithVirtual should revert no matter who the caller is', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.exchangeWithVirtual,
				accounts,
				args: [pUSD, amount, pAUD, toBytes32('AGGREGATOR')],
				reason: 'Cannot be run on this layer',
			});
		});
		it('Mint should revert if the caller is not the minter', async () => {
			const newAccounts = accounts.filter(key => key !== minterRole);
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.inflationalMint,
				accounts: newAccounts,
				args: [],
				reason: 'Cannot be run on this layer',
			});
		});

		it('LiquidateDelinquentAccount should revert no matter who the caller is', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.liquidateDelinquentAccount,
				accounts,
				args: [account1, amount],
				reason: 'Cannot be run on this layer',
			});
		});
		it('MintSecondary should revert no matter who the caller is', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.mintSecondary,
				accounts,
				args: [account1, amount],
				reason: 'Cannot be run on this layer',
			});
		});
		it('MintSecondaryRewards should revert no matter who the caller is', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.mintSecondaryRewards,
				accounts,
				args: [amount],
				reason: 'Cannot be run on this layer',
			});
		});
		it('BurnSecondary should revert no matter who the caller is', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.burnSecondary,
				accounts,
				args: [account1, amount],
				reason: 'Cannot be run on this layer',
			});
		});
	});

	describe('only Exchanger can call emit event functions', () => {
		const amount1 = 10;
		const amount2 = 100;
		const currencyKey1 = pAUD;
		const currencyKey2 = pEUR;
		const trackingCode = toBytes32('1inch');

		it('emitExchangeTracking() cannot be invoked directly by any account', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.emitExchangeTracking,
				accounts,
				args: [trackingCode, currencyKey1, account1],
				reason: 'Only Exchanger can invoke this',
			});
		});
		it('emitExchangeRebate() cannot be invoked directly by any account', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.emitExchangeRebate,
				accounts,
				args: [account1, currencyKey1, amount1],
				reason: 'Only Exchanger can invoke this',
			});
		});
		it('emitExchangeReclaim() cannot be invoked directly by any account', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.emitExchangeReclaim,
				accounts,
				args: [account1, currencyKey1, amount1],
				reason: 'Only Exchanger can invoke this',
			});
		});
		it('emitPynthExchange() cannot be invoked directly by any account', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: basePeriFinance.emitPynthExchange,
				accounts,
				args: [account1, currencyKey1, amount1, currencyKey2, amount2, account2],
				reason: 'Only Exchanger can invoke this',
			});
		});

		describe('Exchanger calls emit', () => {
			const exchanger = account1;
			let tx1, tx2, tx3, tx4;
			beforeEach('pawn Exchanger and sync cache', async () => {
				await addressResolver.importAddresses(['Exchanger'].map(toBytes32), [exchanger], {
					from: owner,
				});
				await basePeriFinance.rebuildCache();
			});
			beforeEach('call event emission functions', async () => {
				tx1 = await basePeriFinance.emitExchangeRebate(account1, currencyKey1, amount1, {
					from: exchanger,
				});
				tx2 = await basePeriFinance.emitExchangeReclaim(account1, currencyKey1, amount1, {
					from: exchanger,
				});
				tx3 = await basePeriFinance.emitPynthExchange(
					account1,
					currencyKey1,
					amount1,
					currencyKey2,
					amount2,
					account2,
					{ from: exchanger }
				);
				tx4 = await basePeriFinance.emitExchangeTracking(trackingCode, currencyKey1, amount1, {
					from: exchanger,
				});
			});

			it('the corresponding events are emitted', async () => {
				it('the corresponding events are emitted', async () => {
					assert.eventEqual(tx1, 'ExchangeRebate', {
						account: account1,
						currencyKey: currencyKey1,
						amount: amount1,
					});
					assert.eventEqual(tx2, 'ExchangeReclaim', {
						account: account1,
						currencyKey: currencyKey1,
						amount: amount1,
					});
					assert.eventEqual(tx3, 'PynthExchange', {
						account: account1,
						fromCurrencyKey: currencyKey1,
						fromAmount: amount1,
						toCurrencyKey: currencyKey2,
						toAmount: amount2,
						toAddress: account2,
					});
					assert.eventEqual(tx4, 'ExchangeTracking', {
						trackingCode: trackingCode,
						toCurrencyKey: currencyKey1,
						toAmount: amount1,
					});
				});
			});
		});
	});

	// currently exchange does not support
	describe('Exchanger calls', () => {
		let smockExchanger;
		beforeEach(async () => {
			smockExchanger = await smockit(artifacts.require('Exchanger').abi);
			smockExchanger.smocked.exchangeOnBehalf.will.return.with(() => '1');
			smockExchanger.smocked.exchangeWithTracking.will.return.with(() => '1');
			smockExchanger.smocked.exchangeOnBehalfWithTracking.will.return.with(() => '1');
			smockExchanger.smocked.settle.will.return.with(() => ['1', '2', '3']);
			await addressResolver.importAddresses(
				['Exchanger'].map(toBytes32),
				[smockExchanger.address],
				{ from: owner }
			);
			await basePeriFinance.rebuildCache();
		});

		const amount1 = '10';
		const currencyKey1 = pAUD;
		const currencyKey2 = pEUR;
		const msgSender = owner;
		const trackingCode = toBytes32('1inch');

		it('exchangeOnBehalf is called with the right arguments ', async () => {
			await basePeriFinance.exchangeOnBehalf(account1, currencyKey1, amount1, currencyKey2, {
				from: owner,
			});
			assert.equal(smockExchanger.smocked.exchangeOnBehalf.calls[0][0], account1);
			assert.equal(smockExchanger.smocked.exchangeOnBehalf.calls[0][1], msgSender);
			assert.equal(smockExchanger.smocked.exchangeOnBehalf.calls[0][2], currencyKey1);
			assert.equal(smockExchanger.smocked.exchangeOnBehalf.calls[0][3].toString(), amount1);
			assert.equal(smockExchanger.smocked.exchangeOnBehalf.calls[0][4], currencyKey2);
		});

		it('exchangeWithTracking is called with the right arguments ', async () => {
			await basePeriFinance.exchangeWithTracking(
				currencyKey1,
				amount1,
				currencyKey2,
				account2,
				trackingCode,
				{ from: owner }
			);
			assert.equal(smockExchanger.smocked.exchangeWithTracking.calls[0][0], msgSender);
			assert.equal(smockExchanger.smocked.exchangeWithTracking.calls[0][1], currencyKey1);
			assert.equal(smockExchanger.smocked.exchangeWithTracking.calls[0][2].toString(), amount1);
			assert.equal(smockExchanger.smocked.exchangeWithTracking.calls[0][3], currencyKey2);
			assert.equal(smockExchanger.smocked.exchangeWithTracking.calls[0][4], msgSender);
			assert.equal(smockExchanger.smocked.exchangeWithTracking.calls[0][5], account2);
			assert.equal(smockExchanger.smocked.exchangeWithTracking.calls[0][6], trackingCode);
		});

		it('exchangeOnBehalfWithTracking is called with the right arguments ', async () => {
			await basePeriFinance.exchangeOnBehalfWithTracking(
				account1,
				currencyKey1,
				amount1,
				currencyKey2,
				account2,
				trackingCode,
				{ from: owner }
			);
			assert.equal(smockExchanger.smocked.exchangeOnBehalfWithTracking.calls[0][0], account1);
			assert.equal(smockExchanger.smocked.exchangeOnBehalfWithTracking.calls[0][1], msgSender);
			assert.equal(smockExchanger.smocked.exchangeOnBehalfWithTracking.calls[0][2], currencyKey1);
			assert.equal(
				smockExchanger.smocked.exchangeOnBehalfWithTracking.calls[0][3].toString(),
				amount1
			);
			assert.equal(smockExchanger.smocked.exchangeOnBehalfWithTracking.calls[0][4], currencyKey2);
			assert.equal(smockExchanger.smocked.exchangeOnBehalfWithTracking.calls[0][5], account2);
			assert.equal(smockExchanger.smocked.exchangeOnBehalfWithTracking.calls[0][6], trackingCode);
		});

		it('settle is called with the right arguments ', async () => {
			await basePeriFinance.settle(currencyKey1, {
				from: owner,
			});
			assert.equal(smockExchanger.smocked.settle.calls[0][0], msgSender);
			assert.equal(smockExchanger.smocked.settle.calls[0][1].toString(), currencyKey1);
		});
	});

	// describe('isWaitingPeriod()', () => {
	// 	it('returns false by default', async () => {
	// 		assert.isFalse(await basePeriFinance.isWaitingPeriod(pETH));
	// 	});
	// 	describe('when a user has exchanged into pETH', () => {
	// 		beforeEach(async () => {
	// 			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });

	// 			await basePeriFinance.issuePynthsAndStakeUSDC(toUnit('100'), toUnit('0'), { from: owner });
	// 			await basePeriFinance.exchange(pUSD, toUnit('10'), pETH, {
	// 				from: owner,
	// 			});
	// 		});
	// 		it('then waiting period is true', async () => {
	// 			assert.isTrue(await basePeriFinance.isWaitingPeriod(pETH));
	// 		});
	// 		describe('when the waiting period expires', () => {
	// 			beforeEach(async () => {
	// 				await fastForward(await systemSettings.waitingPeriodSecs());
	// 			});
	// 			it('returns false by default', async () => {
	// 				assert.isFalse(await basePeriFinance.isWaitingPeriod(pETH));
	// 			});
	// 		});
	// 	});
	// });

	// describe('anyPynthOrPERIRateIsInvalid()', () => {
	// 	it('should have stale rates initially', async () => {
	// 		assert.equal(await basePeriFinance.anyPynthOrPERIRateIsInvalid(), true);
	// 	});
	// 	describe('when pynth rates set', () => {
	// 		beforeEach(async () => {
	// 			// fast forward to get past initial PERI setting
	// 			await fastForward((await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300')));

	// 			timestamp = await currentTime();

	// 			await exchangeRates.updateRates(
	// 				[pAUD, pEUR, pETH],
	// 				['0.5', '1.25', '100'].map(toUnit),
	// 				timestamp,
	// 				{ from: oracle }
	// 			);
	// 			await debtCache.takeDebtSnapshot();
	// 		});
	// 		it('should still have stale rates', async () => {
	// 			assert.equal(await basePeriFinance.anyPynthOrPERIRateIsInvalid(), true);
	// 		});
	// 		describe('when PERI is also set', () => {
	// 			beforeEach(async () => {
	// 				timestamp = await currentTime();

	// 				await exchangeRates.updateRates([PERI], ['1'].map(toUnit), timestamp, { from: oracle });
	// 			});
	// 			it('then no stale rates', async () => {
	// 				assert.equal(await basePeriFinance.anyPynthOrPERIRateIsInvalid(), false);
	// 			});

	// 			describe('when only some pynths are updated', () => {
	// 				beforeEach(async () => {
	// 					await fastForward((await exchangeRates.rateStalePeriod()).add(web3.utils.toBN('300')));

	// 					timestamp = await currentTime();

	// 					await exchangeRates.updateRates([PERI, pAUD], ['0.1', '0.78'].map(toUnit), timestamp, {
	// 						from: oracle,
	// 					});
	// 				});

	// 				it('then anyPynthOrPERIRateIsInvalid() returns true', async () => {
	// 					assert.equal(await basePeriFinance.anyPynthOrPERIRateIsInvalid(), true);
	// 				});
	// 			});
	// 		});
	// 	});
	// });

	// describe('availableCurrencyKeys()', () => {
	// 	it('returns all currency keys by default', async () => {
	// 		assert.deepEqual(await basePeriFinance.availableCurrencyKeys(), [pUSD, pETH, pEUR, pAUD]);
	// 	});
	// });

	// describe('isWaitingPeriod()', () => {
	// 	it('returns false by default', async () => {
	// 		assert.isFalse(await basePeriFinance.isWaitingPeriod(pETH));
	// 	});
	// });

	describe('transfer()', () => {
		describe('when the system is suspended', () => {
			beforeEach(async () => {
				// approve for transferFrom to work
				await basePeriFinance.approve(account1, toUnit('10'), { from: owner });
				await setStatus({
					owner,
					systemStatus,
					section: 'System',
					suspend: true,
				});
			});
			it('when transfer() is invoked, it reverts with operation prohibited', async () => {
				await assert.revert(
					basePeriFinance.transfer(account1, toUnit('10'), { from: owner }),
					'Operation prohibited'
				);
			});
			it('when transferFrom() is invoked, it reverts with operation prohibited', async () => {
				await assert.revert(
					basePeriFinance.transferFrom(owner, account2, toUnit('10'), {
						from: account1,
					}),
					'Operation prohibited'
				);
			});
			describe('when the system is resumed', () => {
				beforeEach(async () => {
					await setStatus({
						owner,
						systemStatus,
						section: 'System',
						suspend: false,
					});
				});
				it('when transfer() is invoked, it works as expected', async () => {
					await basePeriFinance.transfer(account1, toUnit('10'), {
						from: owner,
					});
				});
				it('when transferFrom() is invoked, it works as expected', async () => {
					await basePeriFinance.transferFrom(owner, account2, toUnit('10'), {
						from: account1,
					});
				});
			});
		});

		beforeEach(async () => {
			// Ensure all pynths have rates to allow issuance
			await updateRatesWithDefaults({ exchangeRates, oracle, debtCache });
		});

		it('should transfer using the ERC20 transfer function @gasprofile', async () => {
			// Ensure our environment is set up correctly for our assumptions
			// e.g. owner owns all PERI.

			assert.bnEqual(await basePeriFinance.totalSupply(), await basePeriFinance.balanceOf(owner));

			const transaction = await basePeriFinance.transfer(account1, toUnit('10'), { from: owner });

			assert.eventEqual(transaction, 'Transfer', {
				from: owner,
				to: account1,
				value: toUnit('10'),
			});

			assert.bnEqual(await basePeriFinance.balanceOf(account1), toUnit('10'));
		});

		it('should revert when exceeding locked periFinance and calling the ERC20 transfer function', async () => {
			// Ensure our environment is set up correctly for our assumptions
			// e.g. owner owns all PERI.
			assert.bnEqual(await basePeriFinance.totalSupply(), await basePeriFinance.balanceOf(owner));

			// Issue max pynths.
			await basePeriFinance.issueMaxPynths({ from: owner });

			// Try to transfer 0.000000000000000001 PERI
			await assert.revert(
				basePeriFinance.transfer(account1, '1', { from: owner }),
				'Cannot transfer staked or escrowed PERI'
			);
		});

		it('should transfer using the ERC20 transferFrom function @gasprofile', async () => {
			// Ensure our environment is set up correctly for our assumptions
			// e.g. owner owns all PERI.
			const previousOwnerBalance = await basePeriFinance.balanceOf(owner);
			assert.bnEqual(await basePeriFinance.totalSupply(), previousOwnerBalance);

			// Approve account1 to act on our behalf for 10 PERI.
			let transaction = await basePeriFinance.approve(account1, toUnit('10'), {
				from: owner,
			});
			assert.eventEqual(transaction, 'Approval', {
				owner: owner,
				spender: account1,
				value: toUnit('10'),
			});

			// Assert that transferFrom works.
			transaction = await basePeriFinance.transferFrom(owner, account2, toUnit('10'), {
				from: account1,
			});

			assert.eventEqual(transaction, 'Transfer', {
				from: owner,
				to: account2,
				value: toUnit('10'),
			});

			// Assert that account2 has 10 PERI and owner has 10 less PERI
			assert.bnEqual(await basePeriFinance.balanceOf(account2), toUnit('10'));
			assert.bnEqual(
				await basePeriFinance.balanceOf(owner),
				previousOwnerBalance.sub(toUnit('10'))
			);

			// Assert that we can't transfer more even though there's a balance for owner.
			await assert.revert(
				basePeriFinance.transferFrom(owner, account2, '1', {
					from: account1,
				})
			);
		});

		it('should revert when exceeding locked periFinance and calling the ERC20 transferFrom function', async () => {
			// Ensure our environment is set up correctly for our assumptions
			// e.g. owner owns all PERI.
			assert.bnEqual(await basePeriFinance.totalSupply(), await basePeriFinance.balanceOf(owner));

			// Approve account1 to act on our behalf for 10 PERI.
			const transaction = await basePeriFinance.approve(account1, toUnit('10'), { from: owner });
			assert.eventEqual(transaction, 'Approval', {
				owner: owner,
				spender: account1,
				value: toUnit('10'),
			});

			// Issue max pynths
			await basePeriFinance.issueMaxPynths({ from: owner });

			// Assert that transferFrom fails even for the smallest amount of PERI.
			await assert.revert(
				basePeriFinance.transferFrom(owner, account2, '1', {
					from: account1,
				}),
				'Cannot transfer staked or escrowed PERI'
			);
		});

		// currently exchange doesn`t support
		describe('when the user has issued some pUSD and exchanged for other pynths', () => {
			beforeEach(async () => {
				await basePeriFinance.issuePynths(PERI, toUnit('100'), { from: owner });
				await basePeriFinance.exchange(pUSD, toUnit('10'), pETH, {
					from: owner,
				});
				await basePeriFinance.exchange(pUSD, toUnit('10'), pAUD, {
					from: owner,
				});
				await basePeriFinance.exchange(pUSD, toUnit('10'), pEUR, {
					from: owner,
				});
			});
			it('should transfer using the ERC20 transfer function @gasprofile', async () => {
				await basePeriFinance.transfer(account1, toUnit('10'), { from: owner });

				assert.bnEqual(await basePeriFinance.balanceOf(account1), toUnit('10'));
			});

			it('should transfer using the ERC20 transferFrom function @gasprofile', async () => {
				const previousOwnerBalance = await basePeriFinance.balanceOf(owner);

				// Approve account1 to act on our behalf for 10 PERI.
				await basePeriFinance.approve(account1, toUnit('10'), { from: owner });

				// Assert that transferFrom works.
				await basePeriFinance.transferFrom(owner, account2, toUnit('10'), {
					from: account1,
				});

				// Assert that account2 has 10 PERI and owner has 10 less PERI
				assert.bnEqual(await basePeriFinance.balanceOf(account2), toUnit('10'));
				assert.bnEqual(
					await basePeriFinance.balanceOf(owner),
					previousOwnerBalance.sub(toUnit('10'))
				);

				// Assert that we can't transfer more even though there's a balance for owner.
				await assert.revert(
					basePeriFinance.transferFrom(owner, account2, '1', {
						from: account1,
					})
				);
			});
		});

		describe('rates stale for transfers', () => {
			const value = toUnit('300');
			const ensureTransferReverts = async () => {
				await assert.revert(
					basePeriFinance.transfer(account2, value, { from: account1 }),
					'A pynth or PERI rate is invalid'
				);
				await assert.revert(
					basePeriFinance.transferFrom(account2, account1, value, {
						from: account3,
					}),
					'A pynth or PERI rate is invalid'
				);
			};

			beforeEach(async () => {
				// Give some PERI to account1 & account2
				await basePeriFinance.transfer(account1, toUnit('10000'), {
					from: owner,
				});
				await basePeriFinance.transfer(account2, toUnit('10000'), {
					from: owner,
				});

				// Ensure that we can do a successful transfer before rates go stale
				await basePeriFinance.transfer(account2, value, { from: account1 });

				// approve account3 to transferFrom account2
				await basePeriFinance.approve(account3, toUnit('10000'), {
					from: account2,
				});
				await basePeriFinance.transferFrom(account2, account1, value, {
					from: account3,
				});
			});

			describe('when the user has a debt position', () => {
				beforeEach(async () => {
					// ensure the accounts have a debt position
					await Promise.all([
						basePeriFinance.issuePynths(PERI, toUnit('1'), { from: account1 }),
						basePeriFinance.issuePynths(PERI, toUnit('1'), { from: account2 }),
					]);

					// Now jump forward in time so the rates are stale
					await fastForward((await exchangeRates.rateStalePeriod()) + 1);
				});
				it('should not allow transfer if the exchange rate for PERI is stale', async () => {
					await ensureTransferReverts();

					const timestamp = await currentTime();

					// now give some pynth rates
					await exchangeRates.updateRates([pAUD, pEUR], ['0.5', '1.25'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					await ensureTransferReverts();

					// the remainder of the pynths have prices
					await exchangeRates.updateRates([pETH], ['100'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					await ensureTransferReverts();

					// now give PERI rate
					await exchangeRates.updateRates([PERI], ['1'].map(toUnit), timestamp, {
						from: oracle,
					});

					// now PERI transfer should work
					await basePeriFinance.transfer(account2, value, { from: account1 });
					await basePeriFinance.transferFrom(account2, account1, value, {
						from: account3,
					});
				});

				it('should not allow transfer if the exchange rate for any pynth is stale', async () => {
					await ensureTransferReverts();

					const timestamp = await currentTime();

					// now give PERI rate
					await exchangeRates.updateRates([PERI], ['1'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					await ensureTransferReverts();

					// now give some pynth rates
					await exchangeRates.updateRates([pAUD, pEUR], ['0.5', '1.25'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					await ensureTransferReverts();

					// now give the remainder of pynths rates
					await exchangeRates.updateRates([pETH], ['100'].map(toUnit), timestamp, {
						from: oracle,
					});
					await debtCache.takeDebtSnapshot();

					// now PERI transfer should work
					await basePeriFinance.transfer(account2, value, { from: account1 });
					await basePeriFinance.transferFrom(account2, account1, value, {
						from: account3,
					});
				});
			});

			describe('when the user has no debt', () => {
				it('should allow transfer if the exchange rate for PERI is stale', async () => {
					// PERI transfer should work
					await basePeriFinance.transfer(account2, value, { from: account1 });
					await basePeriFinance.transferFrom(account2, account1, value, {
						from: account3,
					});
				});

				it('should allow transfer if the exchange rate for any pynth is stale', async () => {
					// now PERI transfer should work
					await basePeriFinance.transfer(account2, value, { from: account1 });
					await basePeriFinance.transferFrom(account2, account1, value, {
						from: account3,
					});
				});
			});
		});

		describe('when the user holds PERI', () => {
			beforeEach(async () => {
				await basePeriFinance.transfer(account1, toUnit('1000'), {
					from: owner,
				});
			});

			describe('and has an escrow entry', () => {
				beforeEach(async () => {
					// Setup escrow
					const escrowedPeriFinances = toUnit('30000');
					await basePeriFinance.transfer(escrow.address, escrowedPeriFinances, {
						from: owner,
					});
				});

				it('should allow transfer of periFinance by default', async () => {
					await basePeriFinance.transfer(account2, toUnit('100'), {
						from: account1,
					});
				});

				describe('when the user has a debt position (i.e. has issued)', () => {
					beforeEach(async () => {
						await basePeriFinance.issuePynths(PERI, toUnit('10'), {
							from: account1,
						});
					});

					it('should not allow transfer of periFinance in escrow', async () => {
						// Ensure the transfer fails as all the periFinance are in escrow
						await assert.revert(
							basePeriFinance.transfer(account2, toUnit('990'), {
								from: account1,
							}),
							'Cannot transfer staked or escrowed PERI'
						);
					});
				});
			});
		});

		it('should not be possible to transfer locked periFinance', async () => {
			const issuedPeriFinances = web3.utils.toBN('200000');
			await basePeriFinance.transfer(account1, toUnit(issuedPeriFinances), {
				from: owner,
			});

			// Issue
			const amountIssued = toUnit('2000');
			await basePeriFinance.issuePynths(PERI, amountIssued, { from: account1 });

			await assert.revert(
				basePeriFinance.transfer(account2, toUnit(issuedPeriFinances), {
					from: account1,
				}),
				'Cannot transfer staked or escrowed PERI'
			);
		});

		// currently exchange does not support
		it("should lock newly received periFinance if the user's collaterisation is too high", async () => {
			// Set pEUR for purposes of this test
			const timestamp1 = await currentTime();
			await exchangeRates.updateRates([pEUR], [toUnit('0.75')], timestamp1, {
				from: oracle,
			});
			await debtCache.takeDebtSnapshot();

			const issuedPeriFinances = web3.utils.toBN('200000');
			await basePeriFinance.transfer(account1, toUnit(issuedPeriFinances), {
				from: owner,
			});
			await basePeriFinance.transfer(account2, toUnit(issuedPeriFinances), {
				from: owner,
			});

			const maxIssuablePynths = await basePeriFinance.maxIssuablePynths(account1);

			// Issue
			await basePeriFinance.issuePynths(PERI, maxIssuablePynths, {
				from: account1,
			});

			// Exchange into pEUR
			await basePeriFinance.exchange(pUSD, maxIssuablePynths, pEUR, {
				from: account1,
			});

			// Ensure that we can transfer in and out of the account successfully
			await basePeriFinance.transfer(account1, toUnit('10000'), {
				from: account2,
			});
			await basePeriFinance.transfer(account2, toUnit('10000'), {
				from: account1,
			});

			// Increase the value of pEUR relative to periFinance
			const timestamp2 = await currentTime();
			await exchangeRates.updateRates([pEUR], [toUnit('2.10')], timestamp2, {
				from: oracle,
			});
			await debtCache.takeDebtSnapshot();

			// Ensure that the new periFinance account1 receives cannot be transferred out.
			await basePeriFinance.transfer(account1, toUnit('10000'), {
				from: account2,
			});
			await assert.revert(basePeriFinance.transfer(account2, toUnit('10000'), { from: account1 }));
		});

		// currently exchange does not support
		it('should unlock periFinance when collaterisation ratio changes', async () => {
			// prevent circuit breaker from firing by upping the threshold to factor 5
			await systemSettings.setPriceDeviationThresholdFactor(toUnit('5'), {
				from: owner,
			});

			// Set pAUD for purposes of this test
			const timestamp1 = await currentTime();
			const aud2usdrate = toUnit('2');

			await exchangeRates.updateRates([pAUD], [aud2usdrate], timestamp1, {
				from: oracle,
			});
			await debtCache.takeDebtSnapshot();

			const issuedPeriFinances = web3.utils.toBN('200000');
			await basePeriFinance.transfer(account1, toUnit(issuedPeriFinances), {
				from: owner,
			});

			// Issue
			const issuedPynths = await basePeriFinance.maxIssuablePynths(account1);
			await basePeriFinance.issuePynths(PERI, issuedPynths, { from: account1 });
			const remainingIssuable = (await basePeriFinance.remainingIssuablePynths(account1))[0];

			assert.bnClose(remainingIssuable, '0');

			const transferable1 = await basePeriFinance.transferablePeriFinance(account1);
			assert.bnEqual(transferable1, '0');

			// Exchange into pAUD
			await basePeriFinance.exchange(pUSD, issuedPynths, pAUD, {
				from: account1,
			});

			// Increase the value of pAUD relative to periFinance
			const timestamp2 = await currentTime();
			const newAUDExchangeRate = toUnit('1');
			await exchangeRates.updateRates([pAUD], [newAUDExchangeRate], timestamp2, { from: oracle });
			await debtCache.takeDebtSnapshot();

			const transferable2 = await basePeriFinance.transferablePeriFinance(account1);
			assert.equal(transferable2.gt(toUnit('1000')), true);
		});

		// currently exchange does not support
		describe('when the user has issued some pUSD and exchanged for other pynths', () => {
			beforeEach(async () => {
				await basePeriFinance.issuePynths(PERI, toUnit('100'), { from: owner });
				await basePeriFinance.exchange(pUSD, toUnit('10'), pETH, {
					from: owner,
				});
				await basePeriFinance.exchange(pUSD, toUnit('10'), pAUD, {
					from: owner,
				});
				await basePeriFinance.exchange(pUSD, toUnit('10'), pEUR, {
					from: owner,
				});
			});
			it('should transfer using the ERC20 transfer function @gasprofile', async () => {
				await basePeriFinance.transfer(account1, toUnit('10'), { from: owner });

				assert.bnEqual(await basePeriFinance.balanceOf(account1), toUnit('10'));
			});

			it('should transfer using the ERC20 transferFrom function @gasprofile', async () => {
				const previousOwnerBalance = await basePeriFinance.balanceOf(owner);

				// Approve account1 to act on our behalf for 10 PERI.
				await basePeriFinance.approve(account1, toUnit('10'), { from: owner });

				// Assert that transferFrom works.
				await basePeriFinance.transferFrom(owner, account2, toUnit('10'), {
					from: account1,
				});

				// Assert that account2 has 10 PERI and owner has 10 less PERI
				assert.bnEqual(await basePeriFinance.balanceOf(account2), toUnit('10'));
				assert.bnEqual(
					await basePeriFinance.balanceOf(owner),
					previousOwnerBalance.sub(toUnit('10'))
				);

				// Assert that we can't transfer more even though there's a balance for owner.
				await assert.revert(
					basePeriFinance.transferFrom(owner, account2, '1', {
						from: account1,
					})
				);
			});
		});
	});
});
