'use strict';

const { contract } = require('hardhat');

const { assert } = require('./common');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');

const { setupAllContracts } = require('./setup');

const {
	ensureOnlyExpectedMutativeFunctions,
	onlyGivenAddressCanInvoke,
	setStatus,
} = require('./helpers');
const deploy = require('../../publish/src/commands/deploy');

const { toUnit } = require('../utils')();

contract('StakingStateUSDC', async accounts => {
	const [deployerAccount, owner, account1, account2, account3, tempIssuer] = accounts;
	const [pUSD, PERI, USDC] = ['pUSD', 'PERI', 'USDC'].map(toBytes32);

	let stakingStateUSDC, issuer, USDCContract;

	before(async () => {
		({
			StakingStateUSDC: stakingStateUSDC,
			Issuer: issuer,
			USDC: USDCContract,
		} = await setupAllContracts({
			accounts,
			contracts: [
				'StakingStateUSDC',
				'Issuer',
				'USDC',
				'RewardEscrowV2',
				'PeriFinanceEscrow',
				'Liquidations',
			],
		}));
	});

	describe('constructor', () => {
		it('should set constructor params on deployment', async () => {
			const associatedContract = await stakingStateUSDC.associatedContract();

			assert.isNotEmpty(associatedContract);
			assert.equal(associatedContract, issuer.address);
		});
	});

	it('ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: stakingStateUSDC.abi,
			ignoreParents: ['Owned', 'MixinResolver', 'State'],
			expected: ['setUSDCAddress', 'stake', 'unstake', 'refund'],
		});
	});

	it('check if only owner can call', async () => {
		await onlyGivenAddressCanInvoke({
			fnc: stakingStateUSDC.setUSDCAddress,
			args: [USDCContract.address],
			accounts,
			address: owner,
			skipPassCheck: true,
			reason: 'Only the contract owner may perform this action',
		});
	});

	it('check if only associated contract can call', async () => {
		await onlyGivenAddressCanInvoke({
			fnc: stakingStateUSDC.stake,
			args: [account1, toUnit('1')],
			accounts,
			address: tempIssuer,
			skipPassCheck: true,
			reason: 'Only the associated contract can perform this action',
		});
	});

	it('check if only associated contract can call', async () => {
		await onlyGivenAddressCanInvoke({
			fnc: stakingStateUSDC.unstake,
			args: [account1, toUnit('1')],
			accounts,
			address: tempIssuer,
			skipPassCheck: true,
			reason: 'Only the associated contract can perform this action',
		});
	});

	it('check if only associated contract can call', async () => {
		await onlyGivenAddressCanInvoke({
			fnc: stakingStateUSDC.refund,
			args: [account1, toUnit('1')],
			accounts,
			address: tempIssuer,
			skipPassCheck: true,
			reason: 'Only the associated contract can perform this action',
		});
	});

	describe('staking usdc', () => {
		beforeEach(async () => {
			// set virtual issuer address
			await stakingStateUSDC.setAssociatedContract(tempIssuer, { from: owner });
		});

		it('expect successfully staked', async () => {
			const stakedAmount = toUnit('100');
			await stakingStateUSDC.stake(account1, stakedAmount, { from: tempIssuer });
			await assert.bnEqual(stakedAmount, await stakingStateUSDC.stakedAmountOf(account1));
		});
	});

	describe('unstaking usdc', () => {
		beforeEach(async () => {
			// set virtual issuer address
			await stakingStateUSDC.setAssociatedContract(tempIssuer, { from: owner });
			await stakingStateUSDC.stake(account1, toUnit('100'), { from: tempIssuer });
		});

		it('When user doesnt have enough staked USDC', async () => {
			await assert.revert(
				stakingStateUSDC.unstake(account1, toUnit('1000'), {
					from: tempIssuer,
				}),
				"User doesn't have enough staked amount"
			);
		});

		it('Successfully unstaked', async () => {
			await stakingStateUSDC.unstake(account1, toUnit('100'), { from: tempIssuer });
		});
	});

	describe('refund', () => {
		beforeEach(async () => {
			// set virtual issuer address
			await stakingStateUSDC.setAssociatedContract(tempIssuer, { from: owner });
			// provide USDC to account1 for test
			await USDCContract.transfer(account1, '1000', { from: deployerAccount });
		});

		it.only('should refund', async () => {
			const stakedAmount0 = await stakingStateUSDC.stakedAmountOf(account1);
			console.log(stakedAmount0.toString());
			console.log('-------0-------');
			await stakingStateUSDC.stake(account1, '1000', { from: tempIssuer });
			const stakedAmount1 = await stakingStateUSDC.stakedAmountOf(account1);
			console.log(stakedAmount1.toString());
			console.log('-------1-------');
			await stakingStateUSDC.unstake(account1, '300', { from: tempIssuer });
			const stakedAmount2 = await stakingStateUSDC.stakedAmountOf(account1);
			console.log(stakedAmount2.toString());
			console.log('-------2-------');

			const USDCBALANCE = await USDCContract.balanceOf(account1);
			console.log(USDCBALANCE.toString());
			await stakingStateUSDC.refund(account1, '100', { from: tempIssuer });
		});
	});
});
