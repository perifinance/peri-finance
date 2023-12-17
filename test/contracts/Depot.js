'use strict';

const { contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const {
	currentTime,
	fastForward,
	getEthBalance,
	toUnit,
	multiplyDecimal,
	divideDecimal,
} = require('../utils')();

const {
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
	setStatus,
} = require('./helpers');

const { mockToken, setupAllContracts } = require('./setup');

const { GAS_PRICE } = require('../../hardhat.config');

const { toBytes32 } = require('../..');

contract('Depot', async accounts => {
	let periFinance, pynth, depot, addressResolver, systemStatus, exchangeRates, ethRate, periRate;

	const [, owner, oracle, fundsWallet, address1, address2, address3] = accounts;

	const [PERI, ETH] = ['PERI', 'ETH'].map(toBytes32);

	const approveAndDepositPynths = async (pynthsToDeposit, depositor) => {
		// Approve Transaction
		await pynth.approve(depot.address, pynthsToDeposit, { from: depositor });

		// Deposit pUSD in Depot
		// console.log('Deposit pUSD in Depot amount', pynthsToDeposit, depositor);
		const txn = await depot.depositPynths(pynthsToDeposit, {
			from: depositor,
		});

		return txn;
	};

	// Run once at beginning - snapshots will take care of resetting this before each test
	before(async () => {
		// Mock pUSD as Depot only needs its ERC20 methods (System Pause will not work for suspending pUSD transfers)
		[{ token: pynth }] = await Promise.all([
			mockToken({ accounts, pynth: 'pUSD', name: 'Pynth USD', symbol: 'pUSD' }),
		]);

		({
			Depot: depot,
			AddressResolver: addressResolver,
			ExchangeRates: exchangeRates,
			SystemStatus: systemStatus,
			PeriFinance: periFinance,
		} = await setupAllContracts({
			accounts,
			mocks: {
				// mocks necessary for address resolver imports
				PynthpUSD: pynth,
			},
			contracts: [
				'Depot',
				'AddressResolver',
				'ExchangeRates',
				'SystemStatus',
				'PeriFinance',
				'Issuer',
				'StakingState',
			],
		}));
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		const timestamp = await currentTime();

		periRate = toUnit('0.1');
		ethRate = toUnit('172');

		await exchangeRates.updateRates([PERI, ETH], [periRate, ethRate], timestamp, {
			from: oracle,
		});
	});

	it('should set constructor params on deployment', async () => {
		assert.equal(await depot.fundsWallet(), fundsWallet);
		assert.equal(await depot.resolver(), addressResolver.address);
	});

	describe('Restricted methods', () => {
		it('ensure only known functions are mutative', () => {
			ensureOnlyExpectedMutativeFunctions({
				abi: depot.abi,
				hasFallback: true,
				ignoreParents: ['Pausable', 'ReentrancyGuard', 'MixinResolver'],
				expected: [
					'depositPynths',
					'exchangeEtherForPERI',
					'exchangeEtherForPERIAtRate',
					'exchangeEtherForPynths',
					'exchangeEtherForPynthsAtRate',
					'exchangePynthsForPERI',
					'exchangePynthsForPERIAtRate',
					'setFundsWallet',
					'setMaxEthPurchase',
					'setMinimumDepositAmount',
					'withdrawMyDepositedPynths',
					'withdrawPeriFinance',
				],
			});
		});

		describe('setMaxEthPurchase()', () => {
			it('can only be invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: depot.setMaxEthPurchase,
					args: [toUnit('25')],
					accounts,
					address: owner,
					reason: 'Only the contract owner may perform this action',
				});
			});
			it('when invoked by the owner, changes the expected property', async () => {
				const maxEthPurchase = toUnit('20');
				await depot.setMaxEthPurchase(maxEthPurchase, { from: owner });
				assert.bnEqual(await depot.maxEthPurchase(), maxEthPurchase);
			});
		});

		describe('setFundsWallet()', () => {
			it('can only be invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: depot.setFundsWallet,
					args: [address1],
					accounts,
					address: owner,
					reason: 'Only the contract owner may perform this action',
				});
			});
			it('when invoked by the owner, changes the expected property', async () => {
				const transaction = await depot.setFundsWallet(address1, { from: owner });
				assert.eventEqual(transaction, 'FundsWalletUpdated', { newFundsWallet: address1 });

				assert.equal(await depot.fundsWallet(), address1);
			});
		});

		describe('setMinimumDepositAmount()', () => {
			it('can only be invoked by the owner', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: depot.setMinimumDepositAmount,
					args: [toUnit('100')],
					accounts,
					address: owner,
					reason: 'Only the contract owner may perform this action',
				});
			});
			it('can only be invoked by the owner, and with less than a unit', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: depot.setMinimumDepositAmount,
					args: [toUnit('0.1')],
					accounts,
					address: owner,
					reason: 'Only the contract owner may perform this action',
					skipPassCheck: true,
				});
			});
			it('when invoked by the owner, changes the expected property', async () => {
				const minimumDepositAmount = toUnit('100');
				const setMinimumDepositAmountTx = await depot.setMinimumDepositAmount(
					minimumDepositAmount,
					{
						from: owner,
					}
				);
				assert.eventEqual(setMinimumDepositAmountTx, 'MinimumDepositAmountUpdated', {
					amount: minimumDepositAmount,
				});
				const newMinimumDepositAmount = await depot.minimumDepositAmount();
				assert.bnEqual(newMinimumDepositAmount, minimumDepositAmount);
			});
			it('when invoked by the owner for less than a unit, reverts', async () => {
				await assert.revert(
					depot.setMinimumDepositAmount(toUnit('0.1'), { from: owner }),
					'Minimum deposit amount must be greater than UNIT'
				);
				await assert.revert(
					depot.setMinimumDepositAmount('0', { from: owner }),
					'Minimum deposit amount must be greater than UNIT'
				);
			});
		});
	});

	describe('should increment depositor smallDeposits balance', async () => {
		const pynthsBalance = toUnit('100');
		const depositor = address1;

		beforeEach(async () => {
			// Set up the depositor with an amount of pynths to deposit.
			await pynth.transfer(depositor, pynthsBalance, {
				from: owner,
			});
		});

		describe('when the system is suspended', () => {
			beforeEach(async () => {
				await setStatus({ owner, systemStatus, section: 'System', suspend: true });
			});
			it('when depositPynths is invoked, it reverts with operation prohibited', async () => {
				await assert.revert(
					approveAndDepositPynths(toUnit('1'), depositor),
					'Operation prohibited'
				);
			});

			describe('when the system is resumed', () => {
				beforeEach(async () => {
					await setStatus({ owner, systemStatus, section: 'System', suspend: false });
				});
				it('when depositPynths is invoked, it works as expected', async () => {
					await approveAndDepositPynths(toUnit('1'), depositor);
				});
			});
		});

		it('if the deposit pynth amount is a tiny amount', async () => {
			const pynthsToDeposit = toUnit('0.01');
			// Depositor should initially have a smallDeposits balance of 0
			const initialSmallDepositsBalance = await depot.smallDeposits(depositor);
			assert.equal(initialSmallDepositsBalance, 0);

			await approveAndDepositPynths(pynthsToDeposit, depositor);

			// Now balance should be equal to the amount we just sent
			const smallDepositsBalance = await depot.smallDeposits(depositor);
			assert.bnEqual(smallDepositsBalance, pynthsToDeposit);
		});

		it('if the deposit pynth of 10 amount is less than the minimumDepositAmount', async () => {
			const pynthsToDeposit = toUnit('10');
			// Depositor should initially have a smallDeposits balance of 0
			const initialSmallDepositsBalance = await depot.smallDeposits(depositor);
			assert.equal(initialSmallDepositsBalance, 0);

			await approveAndDepositPynths(pynthsToDeposit, depositor);

			// Now balance should be equal to the amount we just sent
			const smallDepositsBalance = await depot.smallDeposits(depositor);
			assert.bnEqual(smallDepositsBalance, pynthsToDeposit);
		});

		it('if the deposit pynth amount of 49.99 is less than the minimumDepositAmount', async () => {
			const pynthsToDeposit = toUnit('49.99');
			// Depositor should initially have a smallDeposits balance of 0
			const initialSmallDepositsBalance = await depot.smallDeposits(depositor);
			assert.equal(initialSmallDepositsBalance, 0);

			await approveAndDepositPynths(pynthsToDeposit, depositor);

			// Now balance should be equal to the amount we just sent
			const smallDepositsBalance = await depot.smallDeposits(depositor);
			assert.bnEqual(smallDepositsBalance, pynthsToDeposit);
		});
	});

	describe('should accept pynth deposits', async () => {
		const pynthsBalance = toUnit('100');
		const depositor = address1;

		beforeEach(async () => {
			// Set up the depositor with an amount of pynths to deposit.
			await pynth.transfer(depositor, pynthsBalance, {
				from: owner,
			});
		});

		it('if the deposit pynth amount of 50 is the minimumDepositAmount', async () => {
			const pynthsToDeposit = toUnit('50');

			await approveAndDepositPynths(pynthsToDeposit, depositor);

			const events = await depot.getPastEvents();
			const pynthDepositEvent = events.find(log => log.event === 'PynthDeposit');
			const pynthDepositIndex = pynthDepositEvent.args.depositIndex.toString();

			assert.eventEqual(pynthDepositEvent, 'PynthDeposit', {
				user: depositor,
				amount: pynthsToDeposit,
				depositIndex: pynthDepositIndex,
			});

			const depotPynthBalanceCurrent = await pynth.balanceOf(depot.address);
			assert.bnEqual(depotPynthBalanceCurrent, pynthsToDeposit);

			const depositStartIndexAfter = await depot.depositStartIndex();
			const pynthDeposit = await depot.deposits.call(depositStartIndexAfter);
			assert.equal(pynthDeposit.user, depositor);
			assert.bnEqual(pynthDeposit.amount, pynthsToDeposit);
		});

		it('if the deposit pynth amount of 51 is more than the minimumDepositAmount', async () => {
			const pynthsToDeposit = toUnit('51');

			await approveAndDepositPynths(pynthsToDeposit, depositor);

			const events = await depot.getPastEvents();
			const pynthDepositEvent = events.find(log => log.event === 'PynthDeposit');
			const pynthDepositIndex = pynthDepositEvent.args.depositIndex.toString();

			assert.eventEqual(pynthDepositEvent, 'PynthDeposit', {
				user: depositor,
				amount: pynthsToDeposit,
				depositIndex: pynthDepositIndex,
			});

			const depotPynthBalanceCurrent = await pynth.balanceOf(depot.address);
			assert.bnEqual(depotPynthBalanceCurrent, pynthsToDeposit);

			const depositStartIndexAfter = await depot.depositStartIndex();
			const pynthDeposit = await depot.deposits.call(depositStartIndexAfter);
			assert.equal(pynthDeposit.user, depositor);
			assert.bnEqual(pynthDeposit.amount, pynthsToDeposit);
		});
	});

	describe('should not exchange ether for pynths', async () => {
		let fundsWalletFromContract;
		let fundsWalletEthBalanceBefore;
		let pynthsBalance;
		let depotPynthBalanceBefore;

		beforeEach(async () => {
			fundsWalletFromContract = await depot.fundsWallet();
			fundsWalletEthBalanceBefore = await getEthBalance(fundsWallet);
			// Set up the depot so it contains some pynths to convert Ether for
			pynthsBalance = await pynth.balanceOf(owner, { from: owner });

			await approveAndDepositPynths(pynthsBalance, owner);

			depotPynthBalanceBefore = await pynth.balanceOf(depot.address);
		});

		it('if the price is stale', async () => {
			const rateStalePeriod = await exchangeRates.rateStalePeriod();
			await fastForward(Number(rateStalePeriod) + 1);

			// Attempt exchange
			await assert.revert(
				depot.exchangeEtherForPynths({
					from: address1,
					value: 10,
				}),
				'Rate invalid or not a pynth'
			);
			const depotPynthBalanceCurrent = await pynth.balanceOf(depot.address);
			assert.bnEqual(depotPynthBalanceCurrent, depotPynthBalanceBefore);
			assert.bnEqual(await pynth.balanceOf(address1), 0);
			assert.equal(fundsWalletFromContract, fundsWallet);
			assert.bnEqual(await getEthBalance(fundsWallet), fundsWalletEthBalanceBefore);
		});

		it('if the contract is paused', async () => {
			// Pause Contract
			await depot.setPaused(true, { from: owner });

			// Attempt exchange
			await assert.revert(
				depot.exchangeEtherForPynths({
					from: address1,
					value: 10,
				}),
				'This action cannot be performed while the contract is paused'
			);

			const depotPynthBalanceCurrent = await pynth.balanceOf(depot.address);
			assert.bnEqual(depotPynthBalanceCurrent, depotPynthBalanceBefore);
			assert.bnEqual(await pynth.balanceOf(address1), 0);
			assert.equal(fundsWalletFromContract, fundsWallet);
			assert.bnEqual(await getEthBalance(fundsWallet), fundsWalletEthBalanceBefore.toString());
		});

		it('if the system is suspended', async () => {
			const depositStartIndex = await depot.depositStartIndex();
			const depositEndIndex = await depot.depositEndIndex();

			// Assert that there is now one deposit in the queue.
			assert.equal(depositStartIndex, 0);
			assert.equal(depositEndIndex, 1);

			await setStatus({ owner, systemStatus, section: 'System', suspend: true });
			await assert.revert(
				depot.exchangeEtherForPynths({
					from: address1,
					value: toUnit('1'),
				}),
				'Operation prohibited'
			);
			// resume
			await setStatus({ owner, systemStatus, section: 'System', suspend: false });
			// no errors
			await depot.exchangeEtherForPynths({
				from: address1,
				value: 10,
			});
		});
	});

	describe('Ensure user can exchange ETH for Pynths where the amount', async () => {
		const depositor = address1;
		const depositor2 = address2;
		const purchaser = address3;
		const pynthsBalance = toUnit('1000');
		let ethUsd;

		beforeEach(async () => {
			ethUsd = await exchangeRates.rateForCurrency(ETH);

			// Assert that there are no deposits already.
			const depositStartIndex = await depot.depositStartIndex();
			const depositEndIndex = await depot.depositEndIndex();

			assert.equal(depositStartIndex, 0);
			assert.equal(depositEndIndex, 0);

			// Set up the depositor with an amount of pynths to deposit.
			await pynth.transfer(depositor, pynthsBalance.toString(), {
				from: owner,
			});
			await pynth.transfer(depositor2, pynthsBalance.toString(), {
				from: owner,
			});
		});

		['exchangeEtherForPynths function directly', 'fallback function'].forEach(type => {
			const isFallback = type === 'fallback function';

			describe(`using the ${type}`, () => {
				describe('when the system is suspended', () => {
					const ethToSendFromPurchaser = { from: purchaser, value: toUnit('1') };
					let fnc;
					beforeEach(async () => {
						fnc = isFallback ? 'sendTransaction' : 'exchangeEtherForPynths';
						// setup with deposits
						await approveAndDepositPynths(toUnit('1000'), depositor);

						await setStatus({ owner, systemStatus, section: 'System', suspend: true });
					});
					it(`when ${type} is invoked, it reverts with operation prohibited`, async () => {
						await assert.revert(depot[fnc](ethToSendFromPurchaser), 'Operation prohibited');
					});

					describe('when the system is resumed', () => {
						beforeEach(async () => {
							await setStatus({ owner, systemStatus, section: 'System', suspend: false });
						});
						it('when depositPynths is invoked, it works as expected', async () => {
							await depot[fnc](ethToSendFromPurchaser);
						});
					});
				});
			});

			it.skip('exactly matches one deposit (and that the queue is correctly updated) [ @cov-skip ]', async () => {
				const pynthsToDeposit = ethUsd;
				const ethToSend = toUnit('1');
				const depositorStartingBalance = await getEthBalance(depositor);

				// Send the pynths to the Depot.
				const approveTxn = await pynth.approve(depot.address, pynthsToDeposit, {
					from: depositor,
				});
				const gasPaidApprove = web3.utils.toBN(approveTxn.receipt.gasUsed * GAS_PRICE);

				// Deposit pUSD in Depot
				const depositTxn = await depot.depositPynths(pynthsToDeposit, {
					from: depositor,
				});

				const gasPaidDeposit = web3.utils.toBN(depositTxn.receipt.gasUsed * GAS_PRICE);

				const depositStartIndex = await depot.depositStartIndex();
				const depositEndIndex = await depot.depositEndIndex();

				// Assert that there is now one deposit in the queue.
				assert.equal(depositStartIndex, 0);
				assert.equal(depositEndIndex, 1);

				// And assert that our total has increased by the right amount.
				const totalSellableDeposits = await depot.totalSellableDeposits();
				assert.bnEqual(totalSellableDeposits, pynthsToDeposit);

				// Now purchase some.
				let txn;

				if (isFallback) {
					txn = await depot.sendTransaction({
						from: purchaser,
						value: ethToSend,
					});
				} else {
					txn = await depot.exchangeEtherForPynths({
						from: purchaser,
						value: ethToSend,
					});
				}

				// Exchange("ETH", msg.value, "pUSD", fulfilled);
				const exchangeEvent = txn.logs.find(log => log.event === 'Exchange');
				assert.eventEqual(exchangeEvent, 'Exchange', {
					fromCurrency: 'ETH',
					fromAmount: ethToSend,
					toCurrency: 'pUSD',
					toAmount: pynthsToDeposit,
				});

				// Purchaser should have received the Pynths
				const purchaserPynthBalance = await pynth.balanceOf(purchaser);
				assert.bnEqual(purchaserPynthBalance, pynthsToDeposit);

				// Depot should no longer have the pynths
				const depotPynthBalance = await pynth.balanceOf(depot.address);
				assert.equal(depotPynthBalance, 0);

				// We should have no deposit in the queue anymore
				assert.equal(await depot.depositStartIndex(), 1);
				assert.equal(await depot.depositEndIndex(), 1);

				// And our total should be 0 as the purchase amount was equal to the deposit
				assert.equal(await depot.totalSellableDeposits(), 0);

				// The depositor should have received the ETH
				const depositorEndingBalance = await getEthBalance(depositor);
				assert.bnEqual(
					web3.utils
						.toBN(depositorEndingBalance)
						.add(gasPaidApprove)
						.add(gasPaidDeposit),
					web3.utils.toBN(depositorStartingBalance).add(ethToSend)
				);
			});

			it('is less than one deposit (and that the queue is correctly updated)', async () => {
				const pynthsToDeposit = web3.utils.toBN(ethUsd); // ETH Price
				const ethToSend = toUnit('0.5');

				// Send the pynths to the Token Depot.
				await approveAndDepositPynths(pynthsToDeposit, depositor);

				const depositStartIndex = await depot.depositStartIndex();
				const depositEndIndex = await depot.depositEndIndex();

				// Assert that there is now one deposit in the queue.
				assert.equal(depositStartIndex, 0);
				assert.equal(depositEndIndex, 1);

				// And assert that our total has increased by the right amount.
				const totalSellableDeposits = await depot.totalSellableDeposits();
				assert.bnEqual(totalSellableDeposits, pynthsToDeposit);

				assert.bnEqual(await depot.totalSellableDeposits(), (await depot.deposits(0)).amount);

				// Now purchase some.
				let txn;

				if (isFallback) {
					txn = await depot.sendTransaction({
						from: purchaser,
						value: ethToSend,
					});
				} else {
					txn = await depot.exchangeEtherForPynths({
						from: purchaser,
						value: ethToSend,
					});
				}

				// Exchange("ETH", msg.value, "pUSD", fulfilled);
				const exchangeEvent = txn.logs.find(log => log.event === 'Exchange');
				assert.eventEqual(exchangeEvent, 'Exchange', {
					fromCurrency: 'ETH',
					fromAmount: ethToSend,
					toCurrency: 'pUSD',
					toAmount: pynthsToDeposit.div(web3.utils.toBN('2')),
				});

				// We should have one deposit in the queue with half the amount
				assert.equal(await depot.depositStartIndex(), 0);
				assert.equal(await depot.depositEndIndex(), 1);

				assert.bnEqual(await depot.totalSellableDeposits(), (await depot.deposits(0)).amount);

				assert.bnEqual(
					await depot.totalSellableDeposits(),
					pynthsToDeposit.div(web3.utils.toBN('2'))
				);
			});

			it('exceeds one deposit (and that the queue is correctly updated)', async () => {
				const pynthsToDeposit = toUnit('172'); // 1 ETH worth
				const totalPynthsDeposit = toUnit('344'); // 2 ETH worth
				const ethToSend = toUnit('1.5');

				// Send the pynths to the Token Depot.
				await approveAndDepositPynths(pynthsToDeposit, depositor);
				await approveAndDepositPynths(pynthsToDeposit, depositor2);

				const depositStartIndex = await depot.depositStartIndex();
				const depositEndIndex = await depot.depositEndIndex();

				// Assert that there is now two deposits in the queue.
				assert.equal(depositStartIndex, 0);
				assert.equal(depositEndIndex, 2);

				// And assert that our total has increased by the right amount.
				const totalSellableDeposits = await depot.totalSellableDeposits();
				assert.bnEqual(totalSellableDeposits, totalPynthsDeposit);

				// Now purchase some.
				let transaction;
				if (isFallback) {
					transaction = await depot.sendTransaction({
						from: purchaser,
						value: ethToSend,
					});
				} else {
					transaction = await depot.exchangeEtherForPynths({
						from: purchaser,
						value: ethToSend,
					});
				}

				// Exchange("ETH", msg.value, "pUSD", fulfilled);
				const exchangeEvent = transaction.logs.find(log => log.event === 'Exchange');
				const pynthsAmount = multiplyDecimal(ethToSend, ethUsd);

				assert.eventEqual(exchangeEvent, 'Exchange', {
					fromCurrency: 'ETH',
					fromAmount: ethToSend,
					toCurrency: 'pUSD',
					toAmount: pynthsAmount,
				});

				// Purchaser should have received the Pynths
				const purchaserPynthBalance = await pynth.balanceOf(purchaser);
				const depotPynthBalance = await pynth.balanceOf(depot.address);
				const remainingPynths = web3.utils.toBN(totalPynthsDeposit).sub(pynthsAmount);
				assert.bnEqual(purchaserPynthBalance, pynthsAmount);

				assert.bnEqual(depotPynthBalance, remainingPynths);

				// We should have one deposit left in the queue
				assert.equal(await depot.depositStartIndex(), 1);
				assert.equal(await depot.depositEndIndex(), 2);

				// And our total should be totalPynthsDeposit - last purchase
				assert.bnEqual(await depot.totalSellableDeposits(), remainingPynths);
			});

			xit('exceeds available pynths (and that the remainder of the ETH is correctly refunded)', async () => {
				const ethToSend = toUnit('2');
				const pynthsToDeposit = multiplyDecimal(ethToSend, ethRate); // 344
				const purchaserInitialBalance = await getEthBalance(purchaser);

				// Send the pynths to the Token Depot.
				await approveAndDepositPynths(pynthsToDeposit, depositor);

				// Assert that there is now one deposit in the queue.
				assert.equal(await depot.depositStartIndex(), 0);
				assert.equal(await depot.depositEndIndex(), 1);

				// And assert that our total has increased by the right amount.
				const totalSellableDeposits = await depot.totalSellableDeposits();
				assert.equal(totalSellableDeposits.toString(), pynthsToDeposit);

				// Now purchase some
				let txn;

				if (isFallback) {
					txn = await depot.sendTransaction({
						from: purchaser,
						value: ethToSend,
					});
				} else {
					txn = await depot.exchangeEtherForPynths({
						from: purchaser,
						value: ethToSend,
					});
				}

				const gasPaid = web3.utils.toBN(txn.receipt.gasUsed * GAS_PRICE);

				// Exchange("ETH", msg.value, "pUSD", fulfilled);
				const exchangeEvent = txn.logs.find(log => log.event === 'Exchange');

				assert.eventEqual(exchangeEvent, 'Exchange', {
					fromCurrency: 'ETH',
					fromAmount: ethToSend,
					toCurrency: 'pUSD',
					toAmount: pynthsToDeposit,
				});

				// We need to calculate the amount - fees the purchaser is supposed to get
				const pynthsAvailableInETH = divideDecimal(pynthsToDeposit, ethUsd);

				// Purchaser should have received the total available pynths
				const purchaserPynthBalance = await pynth.balanceOf(purchaser);
				assert.equal(pynthsToDeposit.toString(), purchaserPynthBalance.toString());

				// Token Depot should have 0 pynths left
				const depotPynthBalance = await pynth.balanceOf(depot.address);
				assert.equal(depotPynthBalance, 0);

				// The purchaser should have received the refund
				// which can be checked by initialBalance = endBalance + fees + amount of pynths bought in ETH
				const purchaserEndingBalance = await getEthBalance(purchaser);

				// Note: currently failing under coverage via:
				// AssertionError: expected '10000000000000002397319999880134' to equal '10000000000000000000000000000000'
				// 		+ expected - actual
				// 		-10000000000000002397319999880134
				// 		+10000000000000000000000000000000
				assert.bnEqual(
					web3.utils
						.toBN(purchaserEndingBalance)
						.add(gasPaid)
						.add(pynthsAvailableInETH),
					web3.utils.toBN(purchaserInitialBalance)
				);
			});
		});

		describe('exchangeEtherForPynthsAtRate', () => {
			const ethToSend = toUnit('1');
			let pynthsToPurchase;
			let payload;
			let txn;

			beforeEach(async () => {
				pynthsToPurchase = multiplyDecimal(ethToSend, ethRate);
				payload = { from: purchaser, value: ethToSend };
				await approveAndDepositPynths(toUnit('1000'), depositor);
			});

			describe('when the purchaser supplies a rate', () => {
				it('when exchangeEtherForPynthsAtRate is invoked, it works as expected', async () => {
					txn = await depot.exchangeEtherForPynthsAtRate(ethRate, payload);
					const exchangeEvent = txn.logs.find(log => log.event === 'Exchange');
					assert.eventEqual(exchangeEvent, 'Exchange', {
						fromCurrency: 'ETH',
						fromAmount: ethToSend,
						toCurrency: 'pUSD',
						toAmount: pynthsToPurchase,
					});
				});
				it('when purchaser supplies a rate lower than the current rate', async () => {
					await assert.revert(
						depot.exchangeEtherForPynthsAtRate('99', payload),
						'Guaranteed rate would not be received'
					);
				});
				it('when purchaser supplies a rate higher than the current rate', async () => {
					await assert.revert(
						depot.exchangeEtherForPynthsAtRate('9999', payload),
						'Guaranteed rate would not be received'
					);
				});
				it('when the purchaser supplies a rate and the rate is changed in by the oracle', async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, ETH], ['0.1', '134'].map(toUnit), timestamp, {
						from: oracle,
					});
					await assert.revert(
						depot.exchangeEtherForPynthsAtRate(ethRate, payload),
						'Guaranteed rate would not be received'
					);
				});
			});
		});

		describe('exchangeEtherForPERIAtRate', () => {
			const ethToSend = toUnit('1');
			const ethToSendFromPurchaser = { from: purchaser, value: ethToSend };
			let periToPurchase;
			let txn;

			beforeEach(async () => {
				const purchaseValueDollars = multiplyDecimal(ethToSend, ethRate);
				periToPurchase = divideDecimal(purchaseValueDollars, periRate);
				// Send some PERI to the Depot contract
				await periFinance.transfer(depot.address, toUnit('1000000'), {
					from: owner,
				});
			});

			describe('when the purchaser supplies a rate', () => {
				it('when exchangeEtherForPERIAtRate is invoked, it works as expected', async () => {
					txn = await depot.exchangeEtherForPERIAtRate(ethRate, periRate, ethToSendFromPurchaser);
					const exchangeEvent = txn.logs.find(log => log.event === 'Exchange');

					assert.eventEqual(exchangeEvent, 'Exchange', {
						fromCurrency: 'ETH',
						fromAmount: ethToSend,
						toCurrency: 'PERI',
						toAmount: periToPurchase,
					});
				});
				it('when purchaser supplies a rate lower than the current rate', async () => {
					await assert.revert(
						depot.exchangeEtherForPERIAtRate(ethRate, '99', ethToSendFromPurchaser),
						'Guaranteed periFinance rate would not be received'
					);
				});
				it('when purchaser supplies a rate higher than the current rate', async () => {
					await assert.revert(
						depot.exchangeEtherForPERIAtRate(ethRate, '9999', ethToSendFromPurchaser),
						'Guaranteed periFinance rate would not be received'
					);
				});
				it('when the purchaser supplies a rate and the rate is changed in by the oracle', async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI, ETH], ['0.1', '134'].map(toUnit), timestamp, {
						from: oracle,
					});
					await assert.revert(
						depot.exchangeEtherForPERIAtRate(ethRate, periRate, ethToSendFromPurchaser),
						'Guaranteed ether rate would not be received'
					);
				});
			});
		});

		describe('exchangePynthsForPERIAtRate', () => {
			const purchaser = address1;
			const purchaserPynthAmount = toUnit('2000');
			const depotPERIAmount = toUnit('1000000');
			const pynthsToSend = toUnit('1');
			const fromPurchaser = { from: purchaser };
			let periToPurchase;
			let txn;

			beforeEach(async () => {
				// Send the purchaser some pynths
				await pynth.transfer(purchaser, purchaserPynthAmount, {
					from: owner,
				});
				// Send some PERI to the Token Depot contract
				await periFinance.transfer(depot.address, depotPERIAmount, {
					from: owner,
				});

				await pynth.approve(depot.address, pynthsToSend, fromPurchaser);

				const depotPERIBalance = await periFinance.balanceOf(depot.address);
				assert.bnEqual(depotPERIBalance, depotPERIAmount);

				periToPurchase = divideDecimal(pynthsToSend, periRate);
			});

			describe('when the purchaser supplies a rate', () => {
				it('when exchangePynthsForPERIAtRate is invoked, it works as expected', async () => {
					txn = await depot.exchangePynthsForPERIAtRate(pynthsToSend, periRate, fromPurchaser);
					const exchangeEvent = txn.logs.find(log => log.event === 'Exchange');

					assert.eventEqual(exchangeEvent, 'Exchange', {
						fromCurrency: 'pUSD',
						fromAmount: pynthsToSend,
						toCurrency: 'PERI',
						toAmount: periToPurchase,
					});
				});
				it('when purchaser supplies a rate lower than the current rate', async () => {
					await assert.revert(
						depot.exchangePynthsForPERIAtRate(pynthsToSend, '99', fromPurchaser),
						'Guaranteed rate would not be received'
					);
				});
				it('when purchaser supplies a rate higher than the current rate', async () => {
					await assert.revert(
						depot.exchangePynthsForPERIAtRate(pynthsToSend, '9999', fromPurchaser),
						'Guaranteed rate would not be received'
					);
				});
				it('when the purchaser supplies a rate and the rate is changed in by the oracle', async () => {
					const timestamp = await currentTime();
					await exchangeRates.updateRates([PERI], ['0.05'].map(toUnit), timestamp, {
						from: oracle,
					});
					await assert.revert(
						depot.exchangePynthsForPERIAtRate(pynthsToSend, periRate, fromPurchaser),
						'Guaranteed rate would not be received'
					);
				});
			});
		});

		describe('withdrawMyDepositedPynths()', () => {
			describe('when the system is suspended', () => {
				beforeEach(async () => {
					await approveAndDepositPynths(toUnit('100'), depositor);
					await setStatus({ owner, systemStatus, section: 'System', suspend: true });
				});
				it('when withdrawMyDepositedPynths() is invoked, it reverts with operation prohibited', async () => {
					await assert.revert(
						depot.withdrawMyDepositedPynths({ from: depositor }),
						'Operation prohibited'
					);
				});

				describe('when the system is resumed', () => {
					beforeEach(async () => {
						await setStatus({ owner, systemStatus, section: 'System', suspend: false });
					});
					it('when withdrawMyDepositedPynths() is invoked, it works as expected', async () => {
						await depot.withdrawMyDepositedPynths({ from: depositor });
					});
				});
			});

			it('Ensure user can withdraw their Pynth deposit', async () => {
				const pynthsToDeposit = toUnit('500');
				// Send the pynths to the Token Depot.
				await approveAndDepositPynths(pynthsToDeposit, depositor);

				const events = await depot.getPastEvents();
				const pynthDepositEvent = events.find(log => log.event === 'PynthDeposit');
				const pynthDepositIndex = pynthDepositEvent.args.depositIndex.toString();

				// And assert that our total has increased by the right amount.
				const totalSellableDeposits = await depot.totalSellableDeposits();
				assert.bnEqual(totalSellableDeposits, pynthsToDeposit);

				// Wthdraw the deposited pynths
				const txn = await depot.withdrawMyDepositedPynths({ from: depositor });
				const depositRemovedEvent = txn.logs[0];
				const withdrawEvent = txn.logs[1];

				// The sent pynths should be equal the initial deposit
				assert.eventEqual(depositRemovedEvent, 'PynthDepositRemoved', {
					user: depositor,
					amount: pynthsToDeposit,
					depositIndex: pynthDepositIndex,
				});

				// Tells the DApps the deposit is removed from the fifi queue
				assert.eventEqual(withdrawEvent, 'PynthWithdrawal', {
					user: depositor,
					amount: pynthsToDeposit,
				});
			});

			it('Ensure user can withdraw their Pynth deposit even if they sent an amount smaller than the minimum required', async () => {
				const pynthsToDeposit = toUnit('10');

				await approveAndDepositPynths(pynthsToDeposit, depositor);

				// Now balance should be equal to the amount we just sent minus the fees
				const smallDepositsBalance = await depot.smallDeposits(depositor);
				assert.bnEqual(smallDepositsBalance, pynthsToDeposit);

				// Wthdraw the deposited pynths
				const txn = await depot.withdrawMyDepositedPynths({ from: depositor });
				const withdrawEvent = txn.logs[0];

				// The sent pynths should be equal the initial deposit
				assert.eventEqual(withdrawEvent, 'PynthWithdrawal', {
					user: depositor,
					amount: pynthsToDeposit,
				});
			});

			it('Ensure user can withdraw their multiple Pynth deposits when they sent amounts smaller than the minimum required', async () => {
				const pynthsToDeposit1 = toUnit('10');
				const pynthsToDeposit2 = toUnit('15');
				const totalPynthDeposits = pynthsToDeposit1.add(pynthsToDeposit2);

				await approveAndDepositPynths(pynthsToDeposit1, depositor);

				await approveAndDepositPynths(pynthsToDeposit2, depositor);

				// Now balance should be equal to the amount we just sent minus the fees
				const smallDepositsBalance = await depot.smallDeposits(depositor);
				assert.bnEqual(smallDepositsBalance, pynthsToDeposit1.add(pynthsToDeposit2));

				// Wthdraw the deposited pynths
				const txn = await depot.withdrawMyDepositedPynths({ from: depositor });
				const withdrawEvent = txn.logs[0];

				// The sent pynths should be equal the initial deposit
				assert.eventEqual(withdrawEvent, 'PynthWithdrawal', {
					user: depositor,
					amount: totalPynthDeposits,
				});
			});
		});

		it('Ensure user can exchange ETH for Pynths after a withdrawal and that the queue correctly skips the empty entry', async () => {
			//   - e.g. Deposits of [1, 2, 3], user withdraws 2, so [1, (empty), 3], then
			//      - User can exchange for 1, and queue is now [(empty), 3]
			//      - User can exchange for 2 and queue is now [2]
			const deposit1 = toUnit('172');
			const deposit2 = toUnit('200');
			const deposit3 = toUnit('300');

			// Send the pynths to the Token Depot.
			await approveAndDepositPynths(deposit1, depositor);
			await approveAndDepositPynths(deposit2, depositor2);
			await approveAndDepositPynths(deposit3, depositor);

			// Assert that there is now three deposits in the queue.
			assert.equal(await depot.depositStartIndex(), 0);
			assert.equal(await depot.depositEndIndex(), 3);

			// Depositor 2 withdraws Pynths
			await depot.withdrawMyDepositedPynths({ from: depositor2 });

			// Queue should be  [1, (empty), 3]
			const queueResultForDeposit2 = await depot.deposits(1);
			assert.equal(queueResultForDeposit2.amount, 0);

			// User exchange ETH for Pynths (same amount as first deposit)
			const ethToSend = divideDecimal(deposit1, ethRate);
			await depot.exchangeEtherForPynths({
				from: purchaser,
				value: ethToSend,
			});

			// Queue should now be [(empty), 3].
			assert.equal(await depot.depositStartIndex(), 1);
			assert.equal(await depot.depositEndIndex(), 3);
			const queueResultForDeposit1 = await depot.deposits(1);
			assert.equal(queueResultForDeposit1.amount, 0);

			// User exchange ETH for Pynths
			await depot.exchangeEtherForPynths({
				from: purchaser,
				value: ethToSend,
			});

			// Queue should now be [(deposit3 - pynthsPurchasedAmount )]
			const remainingPynths =
				web3.utils.fromWei(deposit3) - web3.utils.fromWei(ethToSend) * web3.utils.fromWei(ethUsd);
			assert.equal(await depot.depositStartIndex(), 2);
			assert.equal(await depot.depositEndIndex(), 3);
			const totalSellableDeposits = await depot.totalSellableDeposits();
			assert.equal(totalSellableDeposits.toString(), toUnit(remainingPynths.toString()));
		});

		it('Ensure multiple users can make multiple Pynth deposits', async () => {
			const deposit1 = toUnit('100');
			const deposit2 = toUnit('200');
			const deposit3 = toUnit('300');
			const deposit4 = toUnit('400');

			// Send the pynths to the Token Depot.
			await approveAndDepositPynths(deposit1, depositor);
			await approveAndDepositPynths(deposit2, depositor2);
			await approveAndDepositPynths(deposit3, depositor);
			await approveAndDepositPynths(deposit4, depositor2);

			// We should have now 4 deposits
			assert.equal(await depot.depositStartIndex(), 0);
			assert.equal(await depot.depositEndIndex(), 4);
		});

		it('Ensure multiple users can make multiple Pynth deposits and multiple withdrawals (and that the queue is correctly updated)', async () => {
			const deposit1 = toUnit('100');
			const deposit2 = toUnit('200');
			const deposit3 = toUnit('300');
			const deposit4 = toUnit('400');

			// Send the pynths to the Token Depot.
			await approveAndDepositPynths(deposit1, depositor);
			await approveAndDepositPynths(deposit2, depositor);
			await approveAndDepositPynths(deposit3, depositor2);
			await approveAndDepositPynths(deposit4, depositor2);

			// We should have now 4 deposits
			assert.equal(await depot.depositStartIndex(), 0);
			assert.equal(await depot.depositEndIndex(), 4);

			// Depositors withdraws all his deposits
			await depot.withdrawMyDepositedPynths({ from: depositor });

			// We should have now 4 deposits
			assert.equal(await depot.depositStartIndex(), 0);
			assert.equal(await depot.depositEndIndex(), 4);

			// First two deposits should be 0
			const firstDepositInQueue = await depot.deposits(0);
			const secondDepositInQueue = await depot.deposits(1);
			assert.equal(firstDepositInQueue.amount, 0);
			assert.equal(secondDepositInQueue.amount, 0);
		});
	});

	describe('Ensure user can exchange ETH for PERI', async () => {
		const purchaser = address1;

		beforeEach(async () => {
			// Send some PERI to the Depot contract
			await periFinance.transfer(depot.address, toUnit('1000000'), {
				from: owner,
			});
		});

		describe('when the system is suspended', () => {
			beforeEach(async () => {
				await setStatus({ owner, systemStatus, section: 'System', suspend: true });
			});
			it('when exchangeEtherForPERI() is invoked, it reverts with operation prohibited', async () => {
				await assert.revert(
					depot.exchangeEtherForPERI({
						from: purchaser,
						value: toUnit('10'),
					}),
					'Operation prohibited'
				);
			});

			describe('when the system is resumed', () => {
				beforeEach(async () => {
					await setStatus({ owner, systemStatus, section: 'System', suspend: false });
				});
				it('when exchangeEtherForPERI() is invoked, it works as expected', async () => {
					await depot.exchangeEtherForPERI({
						from: purchaser,
						value: toUnit('10'),
					});
				});
			});
		});

		it('ensure user get the correct amount of PERI after sending ETH', async () => {
			const ethToSend = toUnit('10');

			const purchaserPERIStartBalance = await periFinance.balanceOf(purchaser);
			// Purchaser should not have PERI yet
			assert.equal(purchaserPERIStartBalance, 0);

			// Purchaser sends ETH
			await depot.exchangeEtherForPERI({
				from: purchaser,
				value: ethToSend,
			});

			const purchaseValueInPynths = multiplyDecimal(ethToSend, ethRate);
			const purchaseValueInPeriFinance = divideDecimal(purchaseValueInPynths, periRate);

			const purchaserPERIEndBalance = await periFinance.balanceOf(purchaser);

			// Purchaser PERI balance should be equal to the purchase value we calculated above
			assert.bnEqual(purchaserPERIEndBalance, purchaseValueInPeriFinance);
		});
	});

	describe('Ensure user can exchange Pynths for PeriFinance', async () => {
		const purchaser = address1;
		const purchaserPynthAmount = toUnit('2000');
		const depotPERIAmount = toUnit('1000000');
		const pynthsToSend = toUnit('1');

		beforeEach(async () => {
			// Send the purchaser some pynths
			await pynth.transfer(purchaser, purchaserPynthAmount, {
				from: owner,
			});
			// We need to send some PERI to the Token Depot contract
			await periFinance.transfer(depot.address, depotPERIAmount, {
				from: owner,
			});

			await pynth.approve(depot.address, pynthsToSend, { from: purchaser });

			const depotPERIBalance = await periFinance.balanceOf(depot.address);
			const purchaserPynthBalance = await pynth.balanceOf(purchaser);
			assert.bnEqual(depotPERIBalance, depotPERIAmount);
			assert.bnEqual(purchaserPynthBalance, purchaserPynthAmount);
		});

		describe('when the system is suspended', () => {
			beforeEach(async () => {
				await setStatus({ owner, systemStatus, section: 'System', suspend: true });
			});
			it('when exchangePynthsForPERI() is invoked, it reverts with operation prohibited', async () => {
				await assert.revert(
					depot.exchangePynthsForPERI(pynthsToSend, {
						from: purchaser,
					}),
					'Operation prohibited'
				);
			});

			describe('when the system is resumed', () => {
				beforeEach(async () => {
					await setStatus({ owner, systemStatus, section: 'System', suspend: false });
				});
				it('when exchangePynthsForPERI() is invoked, it works as expected', async () => {
					await depot.exchangePynthsForPERI(pynthsToSend, {
						from: purchaser,
					});
				});
			});
		});

		it('ensure user gets the correct amount of PERI after sending 10 pUSD', async () => {
			const purchaserPERIStartBalance = await periFinance.balanceOf(purchaser);
			// Purchaser should not have PERI yet
			assert.equal(purchaserPERIStartBalance, 0);

			// Purchaser sends pUSD
			const txn = await depot.exchangePynthsForPERI(pynthsToSend, {
				from: purchaser,
			});

			const purchaseValueInPeriFinance = divideDecimal(pynthsToSend, periRate);

			const purchaserPERIEndBalance = await periFinance.balanceOf(purchaser);

			// Purchaser PERI balance should be equal to the purchase value we calculated above
			assert.bnEqual(purchaserPERIEndBalance, purchaseValueInPeriFinance);

			// assert the exchange event
			const exchangeEvent = txn.logs.find(log => log.event === 'Exchange');

			assert.eventEqual(exchangeEvent, 'Exchange', {
				fromCurrency: 'pUSD',
				fromAmount: pynthsToSend,
				toCurrency: 'PERI',
				toAmount: purchaseValueInPeriFinance,
			});
		});
	});

	describe('withdrawPeriFinance', () => {
		const periAmount = toUnit('1000000');

		beforeEach(async () => {
			// Send some PERI to the Depot contract
			await periFinance.transfer(depot.address, periAmount, {
				from: owner,
			});
		});

		it('when non owner withdrawPeriFinance calls then revert', async () => {
			await onlyGivenAddressCanInvoke({
				fnc: depot.withdrawPeriFinance,
				args: [periAmount],
				accounts,
				address: owner,
				reason: 'Only the contract owner may perform this action',
			});
		});

		it('when owner calls withdrawPeriFinance then withdrawPeriFinance', async () => {
			const depotPERIBalanceBefore = await periFinance.balanceOf(depot.address);

			assert.bnEqual(depotPERIBalanceBefore, periAmount);

			await depot.withdrawPeriFinance(periAmount, { from: owner });

			const depotPERIBalanceAfter = await periFinance.balanceOf(depot.address);
			assert.bnEqual(depotPERIBalanceAfter, toUnit('0'));
		});
	});
});
