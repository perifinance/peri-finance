'use strict';

const { artifacts } = require('hardhat');

const { toBytes32 } = require('../..');

const { prepareSmocks } = require('./helpers');

const VirtualPynth = artifacts.require('VirtualPynth');

// note: cannot use fat-arrow here otherwise this function will be bound to this outer context
module.exports = function({ accounts }) {
	beforeEach(async () => {
		({ mocks: this.mocks, resolver: this.resolver } = await prepareSmocks({
			owner: accounts[1],
			contracts: ['Pynth', 'Exchanger'],
			accounts: accounts.slice(10), // mock using accounts after the first few
		}));
	});

	return {
		// note: use fat-arrow to persist context rather
		whenInstantiated: ({ amount, user, pynth = 'pETH' }, cb) => {
			describe(`when instantiated for user ${user.slice(0, 7)}`, () => {
				beforeEach(async () => {
					this.instance = await VirtualPynth.new(
						this.mocks.Pynth.address,
						this.resolver.address,
						user,
						amount,
						toBytes32(pynth)
					);
				});
				cb();
			});
		},
		whenMockedPynthBalance: ({ balanceOf }, cb) => {
			describe(`when the pynth has been mocked to show balance for the vPynth as ${balanceOf}`, () => {
				beforeEach(async () => {
					this.mocks.Pynth.smocked.balanceOf.will.return.with(acc =>
						acc === this.instance.address ? balanceOf : '0'
					);
				});
				cb();
			});
		},
		whenUserTransfersAwayTokens: ({ amount, from, to }, cb) => {
			describe(`when the user transfers away ${amount} of their vPynths`, () => {
				beforeEach(async () => {
					await this.instance.transfer(to || this.instance.address, amount.toString(), {
						from,
					});
				});
				cb();
			});
		},
		whenMockedSettlementOwing: ({ reclaim = 0, rebate = 0, numEntries = 1 }, cb) => {
			describe(`when settlement owing shows a ${reclaim} reclaim, ${rebate} rebate and ${numEntries} numEntries`, () => {
				beforeEach(async () => {
					this.mocks.Exchanger.smocked.settlementOwing.will.return.with([
						reclaim,
						rebate,
						numEntries,
					]);
				});
				cb();
			});
		},
		whenSettlementCalled: ({ user }, cb) => {
			describe(`when settlement is invoked for user ${user.slice(0, 7)}`, () => {
				beforeEach(async () => {
					// here we simulate how a settlement works with respect to a user's balance
					// Note: this does not account for multiple users - it settles for any account given the exact same way

					const [reclaim, rebate, numEntries] = this.mocks.Exchanger.smocked.settlementOwing.will
						.returnValue || [0, 0, 1];

					// now show the balanceOf the vPynth shows the amount after settlement
					let balanceOf = +this.mocks.Pynth.smocked.balanceOf.will.returnValue(
						this.instance.address
					);

					this.mocks.Exchanger.smocked.settle.will.return.with(() => {
						// update the balanceOf the underlying pynth due to settlement
						balanceOf = reclaim > 0 ? balanceOf - reclaim : balanceOf + rebate;
						// ensure settlementOwing now shows nothing
						this.mocks.Exchanger.smocked.settlementOwing.will.return.with([0, 0, 0]);
						// return what was settled
						return [reclaim, rebate, numEntries];
					});

					this.mocks.Pynth.smocked.transfer.will.return.with((to, amount) => {
						// ensure the vPynths settlement reduces how much balance
						balanceOf = balanceOf - amount;
						return true;
					});

					// use a closure to ensure the balance returned at time of request is the updated one
					this.mocks.Pynth.smocked.balanceOf.will.return.with(() => balanceOf);

					this.txn = await this.instance.settle(user);
				});
				cb();
			});
		},
		whenMockedWithMaxSecsLeft: ({ maxSecsLeft = '0' }, cb) => {
			describe(`when mocked with ${maxSecsLeft} for settlement `, () => {
				beforeEach(async () => {
					this.mocks.Exchanger.smocked.maxSecsLeftInWaitingPeriod.will.return.with(
						maxSecsLeft.toString()
					);
				});
				cb();
			});
		},
	};
};
