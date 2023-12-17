'use strict';

const { contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { toBytes32 } = require('../..');

const {
	currentTime,
	fastForward,
	toUnit,
	// fromUnit,
	toPreciseUnit,
	// fromPreciseUnit,
	multiplyDecimal,
	multiplyDecimalRound,
	// divideDecimalRound,
	// multiplyDecimalRoundPrecise,
	// divideDecimalRoundPrecise,
} = require('../utils')();

const { setExchangeFeeRateForPynths } = require('./helpers');

const { setupAllContracts } = require('./setup');

contract('RewardsIntegrationTests', accounts => {
	// These functions are for manual debugging:

	// const logFeePeriods = async () => {
	// 	const length = (await feePool.FEE_PERIOD_LENGTH()).toNumber();

	// 	console.log('------------------');
	// 	for (let i = 0; i < length; i++) {
	// 		console.log(`Fee Period [${i}]:`);
	// 		const period = await feePool.recentFeePeriods(i);

	// 		for (const key of Object.keys(period)) {
	// 			if (isNaN(parseInt(key))) {
	// 				console.log(`  ${key}: ${period[key]}`);
	// 			}
	// 		}

	// 		console.log();
	// 	}
	// 	console.log('------------------');
	// };

	// const logFeesByPeriod = async account => {
	// 	const length = (await feePool.FEE_PERIOD_LENGTH()).toNumber();
	// 	const feesByPeriod = await feePool.feesByPeriod(account);

	// 	console.log('---------------------feesByPeriod----------------------');
	// 	console.log('Account', account);
	// 	for (let i = 0; i < length; i++) {
	// 		console.log(`Fee Period[${i}] Fees: ${feesByPeriod[i][0]} Rewards: ${feesByPeriod[i][1]}`);
	// 	}
	// 	console.log('--------------------------------------------------------');
	// };

	// CURRENCIES
	const [pUSD, pAUD, pEUR, pBTC, PERI, iBTC, pETH, ETH, USDC] = [
		'pUSD',
		'pAUD',
		'pEUR',
		'pBTC',
		'PERI',
		'iBTC',
		'pETH',
		'ETH',
		'USDC',
	].map(toBytes32);

	const pynthKeys = [pUSD, pAUD, pEUR, pBTC, iBTC, pETH, ETH];

	// Updates rates with defaults so they're not stale.
	const updateRatesWithDefaults = async () => {
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[pAUD, pEUR, PERI, pBTC, iBTC, pETH, ETH, USDC],
			['0.5', '1.25', '0.1', '5000', '4000', '172', '172', '0.9'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);

		await debtCache.takeDebtSnapshot();
	};

	const fastForwardAndCloseFeePeriod = async () => {
		const feePeriodDuration = await feePool.feePeriodDuration();
		// Note: add on a small addition of 10 seconds - this seems to have
		// alleviated an issues with the tests flaking in CircleCI
		// test: "should assign accounts (1,2,3) to have (40%,40%,20%) of the debt/rewards"
		await fastForward(feePeriodDuration.toNumber() + 10);
		await feePool.distributeFeeRewards([], { from: debtManager });
		await feePool.closeCurrentFeePeriod({ from: feeAuthority });

		// Fast forward another day after feePeriod closed before minting
		await fastForward(DAY + 10);

		await updateRatesWithDefaults();
	};

	const fastForwardAndUpdateRates = async seconds => {
		await fastForward(seconds);
		await updateRatesWithDefaults();
	};

	const exchangeFeeRate = toUnit('0.003'); // 30 bips
	const exchangeFeeIncurred = amountToExchange => {
		return multiplyDecimal(amountToExchange, exchangeFeeRate);
	};

	// DIVISIONS
	const half = amount => amount.div(web3.utils.toBN('2'));
	const third = amount => amount.div(web3.utils.toBN('3'));
	// const twoThirds = amount => amount.div(web3.utils.toBN('3')).mul(web3.utils.toBN('2'));
	const quarter = amount => amount.div(web3.utils.toBN('4'));
	// const twoQuarters = amount => amount.div(web3.utils.toBN('4')).mul(web3.utils.toBN('2'));
	// const threeQuarters = amount => amount.div(web3.utils.toBN('4')).mul(web3.utils.toBN('3'));
	const oneFifth = amount => amount.div(web3.utils.toBN('5'));
	const twoFifths = amount => amount.div(web3.utils.toBN('5')).mul(web3.utils.toBN('2'));

	// PERCENTAGES
	const twentyPercent = toPreciseUnit('0.2');
	// const twentyFivePercent = toPreciseUnit('0.25');
	// const thirtyThreePercent = toPreciseUnit('0.333333333333333333333333333');
	const fortyPercent = toPreciseUnit('0.4');
	const fiftyPercent = toPreciseUnit('0.5');

	// AMOUNTS
	const tenK = toUnit('10000');
	const twentyK = toUnit('20000');

	// TIME IN SECONDS
	const SECOND = 1000;
	const MINUTE = SECOND * 60;
	// const HOUR = MINUTE * 60;
	const DAY = 86400;
	const WEEK = 604800;
	// const YEAR = 31556926;

	// ACCOUNTS
	const [
		,
		owner,
		oracle,
		feeAuthority,
		debtManager,
		account1,
		account2,
		account3,
		,
		minterRole,
	] = accounts;

	// VARIABLES
	let feePool,
		// feePoolState,
		periFinance,
		exchangeRates,
		exchanger,
		debtCache,
		supplySchedule,
		systemSettings,
		rewardEscrow,
		periodOneMintableSupplyMinusMinterReward,
		pUSDContract,
		stakingState,
		USDCContract,
		issuer,
		MINTER_PERI_REWARD,
		externalTokenStakeManager,
		crossChainManager;

	// run this once before all tests to prepare our environment, snapshots on beforeEach will take
	// care of resetting to this state
	before(async function() {
		// set a very long timeout for these (requires a non-fat-arrow above)
		this.timeout(180e3);

		({
			ExchangeRates: exchangeRates,
			Exchanger: exchanger,
			DebtCache: debtCache,
			// FeePoolState: feePoolState,
			FeePool: feePool,
			RewardEscrowV2: rewardEscrow,
			SupplySchedule: supplySchedule,
			PeriFinance: periFinance,
			PynthpUSD: pUSDContract,
			SystemSettings: systemSettings,
			StakingState: stakingState,
			USDC: USDCContract,
			Issuer: issuer,
			ExternalTokenStakeManager: externalTokenStakeManager,
			CrossChainManager: crossChainManager,
			// PeriFinanceState: periFinanceState,
		} = await setupAllContracts({
			accounts,
			pynths: ['pUSD', 'pAUD', 'pEUR', 'pBTC', 'iBTC', 'pETH'],
			contracts: [
				'AddressResolver',
				'Exchanger', // necessary for burnPynthsAndUnstakeUSDC to check settlement of pUSD
				'ExchangeRates',
				'FeePool',
				'FeePoolEternalStorage', // necessary to claimFees()
				'FeePoolState', // necessary to claimFees()
				'DebtCache',
				'RewardEscrowV2',
				'RewardsDistribution', // required for PeriFinance.mint()
				'SupplySchedule',
				'PeriFinance',
				'SystemSettings',
				'CollateralManager',
				'StakingState',
				'USDC',
				'Issuer',
				'CrossChainManager',
			],
		}));

		MINTER_PERI_REWARD = await supplySchedule.minterReward();

		await setExchangeFeeRateForPynths({
			owner,
			systemSettings,
			pynthKeys,
			exchangeFeeRates: pynthKeys.map(() => exchangeFeeRate),
		});
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		// Fastforward a year into the staking rewards supply
		// await fastForwardAndUpdateRates(YEAR + MINUTE);
		await fastForwardAndUpdateRates(WEEK + MINUTE);

		// Assign 1/3 of total PERI to 3 accounts
		const periTotalSupply = await periFinance.totalSupply();
		const thirdOfPERI = third(periTotalSupply);

		await periFinance.transfer(account1, thirdOfPERI, { from: owner });
		await periFinance.transfer(account2, thirdOfPERI, { from: owner });
		await periFinance.transfer(account3, thirdOfPERI, { from: owner });

		const USDCTotalSupply = await USDCContract.totalSupply();
		const thirdOfUSDC = third(USDCTotalSupply);
		await USDCContract.transfer(account1, thirdOfUSDC, { from: owner });
		await USDCContract.transfer(account2, thirdOfUSDC, { from: owner });
		await USDCContract.transfer(account3, thirdOfUSDC, { from: owner });

		await USDCContract.approve(externalTokenStakeManager.address, USDCTotalSupply, {
			from: account1,
		});
		await USDCContract.approve(externalTokenStakeManager.address, USDCTotalSupply, {
			from: account2,
		});
		await USDCContract.approve(externalTokenStakeManager.address, USDCTotalSupply, {
			from: account3,
		});

		// Get the PERI mintableSupply
		periodOneMintableSupplyMinusMinterReward = (await supplySchedule.mintableSupply()).sub(
			MINTER_PERI_REWARD
		);

		// console.log(
		// 	`periodOneMintableSupplyMinusMinterReward is ${periodOneMintableSupplyMinusMinterReward}`
		// );

		const netRate = await crossChainManager.currentNetworkDebtPercentage();
		// console.log(`current network debt rate is ${netRate}`);
		assert.bnEqual(netRate, toPreciseUnit('1'));

		// Mint the staking rewards
		await periFinance.inflationalMint({ from: minterRole });

		// set minimumStakeTime on issue and burning to 0
		await systemSettings.setMinimumStakeTime(0, { from: owner });

		// set default issuanceRatio to 0.2
		await systemSettings.setIssuanceRatio(toUnit('0.2'), { from: owner });
	});

	describe('3 accounts with 33.33% PERI all issue MAX and claim rewards', async () => {
		let FEE_PERIOD_LENGTH;
		let CLAIMABLE_PERIODS;

		beforeEach(async () => {
			FEE_PERIOD_LENGTH = (await feePool.FEE_PERIOD_LENGTH()).toNumber();
			CLAIMABLE_PERIODS = FEE_PERIOD_LENGTH - 1;

			await periFinance.issuePynths(PERI, toUnit('1000'), { from: account1 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });
			await periFinance.issuePynths(PERI, toUnit('1000'), { from: account2 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account2 });
			await periFinance.issuePynths(PERI, toUnit('1000'), { from: account3 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account3 });

			await fastForwardAndCloseFeePeriod();
		});

		it('should allocate the 3 accounts a third of the rewards for 1 period', async () => {
			// All 3 accounts claim rewards
			await feePool.claimFees({ from: account1 });
			await feePool.claimFees({ from: account2 });
			await feePool.claimFees({ from: account3 });

			// All 3 accounts have 1/3 of the rewards
			const accOneEscrowed = await rewardEscrow.getVestingEntry(account1, 1);
			assert.bnClose(accOneEscrowed.escrowAmount, third(periodOneMintableSupplyMinusMinterReward));

			const accTwoEscrowed = await rewardEscrow.getVestingEntry(account2, 2);
			assert.bnClose(accTwoEscrowed.escrowAmount, third(periodOneMintableSupplyMinusMinterReward));

			const accThreeEscrowed = await rewardEscrow.getVestingEntry(account3, 3);
			assert.bnClose(
				accThreeEscrowed.escrowAmount,
				third(periodOneMintableSupplyMinusMinterReward)
			);
		});

		it('should revert when the USDC Quota is above 20%', async () => {
			await exchangeRates.updateRates([USDC], [toUnit('1')], await currentTime(), {
				from: oracle,
			});

			await periFinance.issuePynths(PERI, toUnit('666'), { from: account1 });
			await periFinance.issuePynthsToMaxQuota(USDC, { from: account1 });

			// make USDC quota above 20%
			await exchangeRates.updateRates([USDC], [toUnit('1.2')], await currentTime(), {
				from: oracle,
			});

			await assert.revert(feePool.claimFees({ from: account1 }), 'C-Ratio below penalty threshold');
		});

		it('should show the totalRewardsAvailable in the claimable period 1', async () => {
			// Assert that we have correct values in the fee pool
			const totalRewardsAvailable = await feePool.totalRewardsAvailable();

			assert.bnEqual(totalRewardsAvailable, periodOneMintableSupplyMinusMinterReward);
		});

		it('should show the totalRewardsAvailable in the claimable periods 1 & 2', async () => {
			let mintedRewardsSupply, totalRewardsAvailable;
			let twoWeeksRewards = periodOneMintableSupplyMinusMinterReward;
			// We are currently in the 2nd week, close it and the next
			for (let i = 0; i <= CLAIMABLE_PERIODS - 1; i++) {
				// FastForward a little for minting
				await fastForwardAndUpdateRates(MINUTE);

				// Get the PERI mintableSupply - the minter reward of 200 PERI
				mintedRewardsSupply = (await supplySchedule.mintableSupply()).sub(MINTER_PERI_REWARD);
				// console.log(`mintedRewardsSupply ${i} --> ${mintedRewardsSupply}`);

				// we sum all mintable supplies in the period because the decay is possibly on.
				twoWeeksRewards = twoWeeksRewards.add(mintedRewardsSupply);

				// Mint the staking rewards
				await periFinance.inflationalMint({ from: minterRole });

				await fastForwardAndCloseFeePeriod();

				totalRewardsAvailable = await feePool.totalRewardsAvailable();
				// console.log(`totalRewardsAvailable ${i} --> ${totalRewardsAvailable}`);

				// await logFeePeriods();
			}

			// we need to skip the first period rewards becuase the minting started long time ago.
			totalRewardsAvailable = await feePool.totalRewardsAvailable();

			assert.bnEqual(totalRewardsAvailable, twoWeeksRewards);
		});

		it('should show the totalRewardsAvailable in the claimable periods 1 & 2 after 2 accounts claims', async () => {
			let mintedRewardsSupply;
			let twoWeeksRewards = periodOneMintableSupplyMinusMinterReward;
			// We are currently in the 2nd week, close it and the next
			for (let i = 0; i <= CLAIMABLE_PERIODS - 1; i++) {
				// FastForward a little for minting
				await fastForwardAndUpdateRates(MINUTE);

				// Get the PERI mintableSupply - the minter reward of 200 PERI
				mintedRewardsSupply = (await supplySchedule.mintableSupply()).sub(MINTER_PERI_REWARD);
				// we sum all mintable supplies in the period because the decay is possibly on.
				twoWeeksRewards = twoWeeksRewards.add(mintedRewardsSupply);
				// console.log('mintedRewardsSupply', mintedRewardsSupply.toString());
				// Mint the staking rewards
				await periFinance.inflationalMint({ from: minterRole });

				// console.log('Close Fee Period', i);
				await fastForwardAndCloseFeePeriod();

				// await logFeePeriods();
			}

			await feePool.claimFees({ from: account1 });
			await feePool.claimFees({ from: account2 });
			// await logFeePeriods();

			// Assert that we have correct values in the fee pool
			const totalRewardsAvailable = await feePool.totalRewardsAvailable();

			const rewardsLessAccountClaims = third(twoWeeksRewards);

			assert.bnClose(totalRewardsAvailable, rewardsLessAccountClaims, 10);
		});

		it('should mint PERI for the all claimable fee periods then all 3 accounts claim at the end of the claimable period', async () => {
			let mintedRewardsSupply;
			let twoWeeksRewards = periodOneMintableSupplyMinusMinterReward;
			// We are currently in the 2nd week, close it and the next
			for (let i = 0; i <= CLAIMABLE_PERIODS - 1; i++) {
				// FastForward a little for minting
				await fastForwardAndUpdateRates(MINUTE);

				// Get the PERI mintableSupply - the minter reward of 200 PERI
				mintedRewardsSupply = (await supplySchedule.mintableSupply()).sub(MINTER_PERI_REWARD);
				twoWeeksRewards = twoWeeksRewards.add(mintedRewardsSupply);

				// Mint the staking rewards
				await periFinance.inflationalMint({ from: minterRole });

				await fastForwardAndCloseFeePeriod();

				// await logFeePeriods();
			}

			// All 3 accounts claim rewards
			await feePool.claimFees({ from: account1 });
			await feePool.claimFees({ from: account2 });
			await feePool.claimFees({ from: account3 });

			// await logFeePeriods();

			twoWeeksRewards = third(twoWeeksRewards);

			// All 3 accounts have 1/3 of the rewards
			const accOneEscrowed = await rewardEscrow.getVestingEntry(account1, 1);
			assert.bnClose(accOneEscrowed.escrowAmount, twoWeeksRewards);

			const accTwoEscrowed = await rewardEscrow.getVestingEntry(account2, 2);
			assert.bnClose(accTwoEscrowed.escrowAmount, twoWeeksRewards);

			const accThreeEscrowed = await rewardEscrow.getVestingEntry(account3, 3);
			assert.bnClose(accThreeEscrowed.escrowAmount, twoWeeksRewards);
		});

		it('should rollover the unclaimed PERI rewards', async () => {
			// Close all claimable periods
			for (let i = 0; i < CLAIMABLE_PERIODS; i++) {
				// FastForward a bit to be able to mint
				await fastForwardAndUpdateRates(MINUTE);

				// Mint the staking rewards
				await periFinance.inflationalMint({ from: minterRole });

				// console.log('Close Fee Period', i);
				await fastForwardAndCloseFeePeriod();

				// await logFeePeriods();
			}
			// Get the Rewards to roll over from the last week
			const periodToRollOver = await feePool.recentFeePeriods(CLAIMABLE_PERIODS);
			const rollOverRewards = periodToRollOver.rewardsToDistribute;

			// console.log(`rollOverRewards ${rollOverRewards}`);

			// Get the PERI mintableSupply - the minter reward of 200 PERI
			const mintedRewardsSupply = (await supplySchedule.mintableSupply()).sub(MINTER_PERI_REWARD);

			// FastForward a bit to be able to mint
			await fastForwardAndUpdateRates(MINUTE);
			// Mint the staking rewards
			await periFinance.inflationalMint({ from: minterRole });
			// Close the extra week
			await fastForwardAndCloseFeePeriod();

			// Get last FeePeriod
			const lastFeePeriod = await feePool.recentFeePeriods(CLAIMABLE_PERIODS);

			// console.log(`lastFeePeriod.rewardsToDistribute ${lastFeePeriod.rewardsToDistribute}`);

			// await logFeePeriods();

			// Assert rewards have rolled over
			assert.bnEqual(lastFeePeriod.rewardsToDistribute, rollOverRewards.add(mintedRewardsSupply));
		});

		it('should rollover the unclaimed PERI rewards on week over 2 terms', async () => {
			for (let i = 0; i <= CLAIMABLE_PERIODS; i++) {
				// FastForward a bit to be able to mint
				await fastForwardAndUpdateRates(MINUTE);
				// Mint the staking rewards
				await periFinance.inflationalMint({ from: minterRole });
				// await logFeePeriods();
				await fastForwardAndCloseFeePeriod();
			}
			// Get the Rewards to RollOver
			const periodToRollOver = await feePool.recentFeePeriods(CLAIMABLE_PERIODS);
			const rollOverRewards = periodToRollOver.rewardsToDistribute;

			// FastForward a bit to be able to mint
			await fastForwardAndUpdateRates(MINUTE);
			// Get the PERI mintableSupply - the minter reward of 200 PERI
			const mintedRewardsSupply = (await supplySchedule.mintableSupply()).sub(MINTER_PERI_REWARD);

			// Mint the staking rewards
			await periFinance.inflationalMint({ from: minterRole });

			await fastForwardAndCloseFeePeriod();
			// Get last FeePeriod
			const lastFeePeriod = await feePool.recentFeePeriods(CLAIMABLE_PERIODS);
			// await logFeePeriods();
			// Assert rewards have rolled over
			assert.bnEqual(lastFeePeriod.rewardsToDistribute, mintedRewardsSupply.add(rollOverRewards));
		});

		it('should rollover the partial unclaimed PERI rewards', async () => {
			// await logFeePeriods();
			for (let i = 0; i <= FEE_PERIOD_LENGTH; i++) {
				// FastForward a bit to be able to mint
				await fastForwardAndUpdateRates(MINUTE);
				// Mint the staking rewards
				await periFinance.inflationalMint({ from: minterRole });

				// Get the Rewards to RollOver
				const periodToRollOver = await feePool.recentFeePeriods(CLAIMABLE_PERIODS);
				const currenPeriod = await feePool.recentFeePeriods(CLAIMABLE_PERIODS - 1);
				const rollOverRewards = periodToRollOver.rewardsToDistribute.sub(
					periodToRollOver.rewardsClaimed
				);
				const previousRewards = currenPeriod.rewardsToDistribute;

				await fastForwardAndCloseFeePeriod();

				// Only 1 account claims rewards
				await feePool.claimFees({ from: account1 });
				// await logFeePeriods();

				// Get last FeePeriod
				const lastFeePeriod = await feePool.recentFeePeriods(CLAIMABLE_PERIODS);

				// Assert that Account 1 has claimed a third of the rewardsToDistribute
				assert.bnClose(lastFeePeriod.rewardsClaimed, third(lastFeePeriod.rewardsToDistribute));

				// Assert rewards have rolled over
				assert.bnEqual(lastFeePeriod.rewardsToDistribute, previousRewards.add(rollOverRewards));
			}
		});

		it('should allow a user to leave the system and return and still claim rewards', async () => {
			// FastForward a bit to be able to mint
			await fastForwardAndUpdateRates(MINUTE);

			// Get the PERI mintableSupply - the minter reward of 200 PERI
			const mintedRewardsSupply = (await supplySchedule.mintableSupply()).sub(MINTER_PERI_REWARD);

			// Mint the staking rewards
			await periFinance.inflationalMint({ from: minterRole });
			// await logFeePeriods();
			// await logFeesByPeriod(account1);
			// ---------------------feesByPeriod----------------------
			// Fee Period[0] Fees: 0 Rewards: 54773152474663323426589
			// Fee Period[1] Fees: 0 Rewards: 1872787113515042654768040
			// --------------------------------------------------------

			// Account 1 leaves the system in week 2
			const burnableTotal = (await periFinance.debtBalanceOf(account1, pUSD)).sub(toUnit('10'));

			await periFinance.burnPynths(USDC, toUnit('10'), { from: account1 });
			await periFinance.burnPynths(PERI, burnableTotal, { from: account1 });
			// await logFeesByPeriod(account1);
			// ---------------------feesByPeriod----------------------
			// Fee Period[0] Fees: 0 Rewards: 0
			// Fee Period[1] Fees: 0 Rewards: 1872787113515042654768040
			// --------------------------------------------------------

			// Account 1 comes back into the system
			await periFinance.issuePynths(PERI, toUnit('1000'), { from: account1 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });
			// await logFeesByPeriod(account1);
			// ---------------------feesByPeriod----------------------
			// Fee Period[0] Fees: 0 Rewards: 18257717491554441142196
			// Fee Period[1] Fees: 0 Rewards: 1872787113515042654768040
			// --------------------------------------------------------

			const rewardsAmount1stweek = third(periodOneMintableSupplyMinusMinterReward);
			const rewardsAmount2ndweek = third(mintedRewardsSupply);
			const feesByPeriod = await feePool.feesByPeriod(account1);

			// Assert Account 1 has re-entered the system and has awards in period 0 & 1
			assert.bnClose(feesByPeriod[0][1], rewardsAmount2ndweek);
			assert.bnClose(feesByPeriod[1][1], rewardsAmount1stweek);

			await fastForwardAndCloseFeePeriod();

			// await logFeePeriods();
			// await logFeesByPeriod(account1);
			// ---------------------feesByPeriod----------------------
			// Fee Period[0] Fees: 0 Rewards: 0
			// Fee Period[1] Fees: 0 Rewards: 1891044831006597095910237
			// --------------------------------------------------------

			// await fastForwardAndCloseFeePeriod();
			// Only Account 1 claims rewards
			await feePool.claimFees({ from: account1 });
			// await logFeesByPeriod(account1);
			// ---------------------feesByPeriod----------------------
			// Fee Period[0] Fees: 0 Rewards: 0
			// Fee Period[1] Fees: 0 Rewards: 0
			// --------------------------------------------------------

			const rewardsAmount = rewardsAmount1stweek.add(rewardsAmount2ndweek);

			// Assert Account 1 has their rewards
			const account1EscrowEntry = await rewardEscrow.getVestingEntry(account1, 1);
			assert.bnClose(account1EscrowEntry.escrowAmount, rewardsAmount);
		});

		it('should allocate correct PERI rewards as others leave the system', async () => {
			// Account1 claims but 2 & 3 dont
			await feePool.claimFees({ from: account1 });

			// All Account 1 has 1/3 of the rewards escrowed
			const account1Escrowed = await rewardEscrow.getVestingEntry(account1, 1);
			assert.bnClose(
				account1Escrowed.escrowAmount,
				third(periodOneMintableSupplyMinusMinterReward),
				1
			);

			// Account 1 leaves the system
			const burnableTotal = (await periFinance.debtBalanceOf(account1, pUSD)).sub(toUnit('10'));
			await periFinance.burnPynths(USDC, toUnit('10'), { from: account1 });
			await periFinance.burnPynths(PERI, burnableTotal, { from: account1 });

			// FastForward into the second mintable week
			await fastForwardAndUpdateRates(WEEK + MINUTE);

			// Get the PERI mintableSupply for period 2
			const period2MintedRewardsSupply = (await supplySchedule.mintableSupply()).sub(
				MINTER_PERI_REWARD
			);

			// Mint the staking rewards for p2
			await periFinance.inflationalMint({ from: minterRole });

			// Close the period after user leaves system
			fastForwardAndCloseFeePeriod();

			// Account1 Reenters in current unclosed period so no rewards yet
			// await periFinance.issuePynths(PERI,toUnit('1000'), { from: account1 });
			// await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });

			// Accounts 2 & 3 now have 33% of period 1 and 50% of period 2
			// console.log('33% of p1', third(periodOneMintableSupplyMinusMinterReward).toString());
			// console.log('50% of p2', half(period2MintedRewardsSupply).toString());
			const rewardsAmount = third(periodOneMintableSupplyMinusMinterReward).add(
				half(period2MintedRewardsSupply)
			);
			// console.log('rewardsAmount calculated', rewardsAmount.toString());

			// await logFeePeriods();
			await new Promise(resolve => setTimeout(resolve, 1000)); // Test would fail without the logFeePeriods(). Race condition on chain. Just need to delay a tad.

			// Check account2 has correct rewardsAvailable
			const account2Rewards = await feePool.feesAvailable(account2);
			// console.log('account2Rewards', rewardsAmount.toString(), account2Rewards[1].toString());
			assert.bnClose(account2Rewards[1], rewardsAmount, '2');

			// Check account3 has correct rewardsAvailable
			const account3Rewards = await feePool.feesAvailable(account3);
			// console.log('rewardsAvailable', rewardsAmount.toString(), account3Rewards[1].toString());
			assert.bnClose(account3Rewards[1], rewardsAmount, '1');

			// Accounts 2 & 3 claim
			await feePool.claimFees({ from: account2 });
			// updateRatesWithDefaults();
			await feePool.claimFees({ from: account3 });

			// Accounts 2 & 3 now have the rewards escrowed
			const account2Escrowed = await rewardEscrow.getVestingEntry(account2, 2);
			// console.log('account2Escrowed[3]', account2Escrowed[1].toString());
			assert.bnClose(account2Escrowed.escrowAmount, rewardsAmount, '1');
			const account3Escrowed = await rewardEscrow.getVestingEntry(account3, 3);
			// console.log('account3Escrowed[3]', account2Escrowed[1].toString());
			assert.bnClose(account3Escrowed.escrowAmount, rewardsAmount, '1');
		});
	});

	describe('Exchange Rate Shift tests', async () => {
		it('should assign accounts (1,2,3) to have (40%,40%,20%) of the debt/rewards', async () => {
			// Account 1&2 issue 10K USD and exchange in pBTC each, holding 50% of the total debt.
			await periFinance.issuePynths(PERI, tenK, { from: account1 });
			// await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });
			await periFinance.issuePynths(PERI, tenK, { from: account2 });
			// await periFinance.issuePynths(USDC, toUnit('10'), { from: account2 });

			await periFinance.exchange(pUSD, tenK, pBTC, { from: account1 });
			await periFinance.exchange(pUSD, tenK, pBTC, { from: account2 });

			await fastForwardAndCloseFeePeriod();
			// //////////////////////////////////////////////
			// 2nd Week
			// //////////////////////////////////////////////

			// Assert 1, 2 have 50% each of the effectiveDebtRatioForPeriod
			const debtRatioAccount1 = await feePool.effectiveDebtRatioForPeriod(account1, 1);
			// console.log('debtRatioAccount1', debtRatioAccount1.toString());
			const debtRatioAccount2 = await feePool.effectiveDebtRatioForPeriod(account2, 1);
			// console.log('debtRatioAccount2', debtRatioAccount1.toString());

			assert.bnClose(debtRatioAccount1, fiftyPercent);
			assert.bnEqual(debtRatioAccount2, fiftyPercent);

			// Accounts 1&2 claim rewards
			await feePool.claimFees({ from: account1 });
			await feePool.claimFees({ from: account2 });

			// Assert Accounts 1&2 have 50% of the minted rewards in their initial escrow entry
			const account1Escrow = await rewardEscrow.getVestingEntry(account1, 1);
			// console.log('account1Escrow[3]', account1Escrow[3].toString());
			assert.bnClose(
				account1Escrow.escrowAmount,
				half(periodOneMintableSupplyMinusMinterReward),
				1
			);

			const account2Escrow = await rewardEscrow.getVestingEntry(account2, 2);
			// console.log('account2Escrow[3]', account2Escrow[3].toString());
			assert.bnClose(
				account2Escrow.escrowAmount,
				half(periodOneMintableSupplyMinusMinterReward),
				1
			);

			// Increase pBTC price by 100%
			const timestamp = await currentTime();
			await exchangeRates.updateRates([pBTC], ['10000'].map(toUnit), timestamp, {
				from: oracle,
			});
			await debtCache.takeDebtSnapshot();

			// Account 3 (enters the system and) mints 10K pUSD (minus half of an exchange fee - to balance the fact
			// that the other two holders have doubled their pBTC holdings) and should have 20% of the debt not 33.33%
			const potentialFee = exchangeFeeIncurred(toUnit('10000'));
			await periFinance.issuePynths(PERI, tenK.sub(half(potentialFee)), {
				from: account3,
			});
			// await periFinance.issuePynths(USDC, toUnit('10'), { from: account3 });

			// Get the PERI mintableSupply for week 2
			const periodTwoMintableSupply = (await supplySchedule.mintableSupply()).sub(
				MINTER_PERI_REWARD
			);

			// Mint the staking rewards
			await periFinance.inflationalMint({ from: minterRole });

			// Do some exchanging to generateFees
			const { amountReceived } = await exchanger.getAmountsForExchange(tenK, pUSD, pBTC);
			await periFinance.exchange(pBTC, amountReceived, pUSD, { from: account1 });
			await periFinance.exchange(pBTC, amountReceived, pUSD, { from: account2 });

			// console.log(`amountReceived: ${amountReceived}`);
			// Close so we can claim
			await fastForwardAndCloseFeePeriod();
			// //////////////////////////////////////////////
			// 3rd Week
			// //////////////////////////////////////////////

			// await logFeePeriods();
			// Note: this is failing because 10k isn't 20% but rather a shade more, this is
			// due to the fact that 10k isn't accurately the right amount - should be

			// Assert (1,2,3) have (40%,40%,20%) of the debt in the recently closed period
			const acc1Ownership = await feePool.effectiveDebtRatioForPeriod(account1, 1);
			const acc2Ownership = await feePool.effectiveDebtRatioForPeriod(account2, 1);
			const acc3Ownership = await feePool.effectiveDebtRatioForPeriod(account3, 1);
			// console.log('Account1.effectiveDebtRatioForPeriod', acc1Ownership.toString());
			// console.log('Account2.effectiveDebtRatioForPeriod', acc2Ownership.toString());
			// console.log('Account3.effectiveDebtRatioForPeriod', acc3Ownership.toString());
			assert.bnClose(acc1Ownership, fortyPercent, '6010'); // add on a delta of ~6010 to handle 27 digit precision errors
			assert.bnClose(acc2Ownership, fortyPercent, '6010');
			assert.bnClose(acc3Ownership, twentyPercent, '89000');

			// await logFeesByPeriod(account1);
			// await logFeesByPeriod(account2);
			// await logFeesByPeriod(account3);

			// All 3 accounts claim rewards
			await feePool.claimFees({ from: account1 });
			await feePool.claimFees({ from: account2 });
			await feePool.claimFees({ from: account3 });

			// await logFeePeriods();

			// Assert (1,2,3) have (40%,40%,20%) of the rewards in their 2nd escrow entry
			const account1EscrowEntry2 = await rewardEscrow.getVestingEntry(account1, 3);
			const account2EscrowEntry2 = await rewardEscrow.getVestingEntry(account2, 4);
			const account3EscrowEntry1 = await rewardEscrow.getVestingEntry(account3, 5); // Account3's first escrow entry
			// console.log('account1EscrowEntry2[3]', account1EscrowEntry2[3].toString());
			// console.log(
			// 	'twoFifths(periodTwoMintableSupply)',
			// 	twoFifths(periodTwoMintableSupply).toString()
			// );
			// console.log('account2EscrowEntry2[3]', account2EscrowEntry2[3].toString());
			// console.log(
			// 	'twoFifths(periodTwoMintableSupply)',
			// 	twoFifths(periodTwoMintableSupply).toString()
			// );
			// console.log('account3EscrowEntry1[3]', account3EscrowEntry1[3].toString());
			// console.log(
			// 	'oneFifth(periodTwoMintableSupply)',
			// 	oneFifth(periodTwoMintableSupply).toString()
			// );

			assert.bnClose(account1EscrowEntry2.escrowAmount, twoFifths(periodTwoMintableSupply));
			assert.bnClose(account2EscrowEntry2.escrowAmount, twoFifths(periodTwoMintableSupply));
			assert.bnClose(account3EscrowEntry1.escrowAmount, oneFifth(periodTwoMintableSupply), 17);

			// Commenting out this logic for now (v2.14.x) - needs to be relooked at -JJ

			// // now in p3 Acc1 burns all and leaves (-40%) and Acc2 has 67% and Acc3 33% rewards allocated as such
			// // Account 1 exchanges all pBTC back to pUSD
			// const acc1pBTCBalance = await pBTCContract.balanceOf(account1, { from: account1 });
			// await periFinance.exchange(pBTC, acc1pBTCBalance, pUSD, { from: account1 });
			// const amountAfterExchange = await feePool.amountReceivedFromExchange(acc1pBTCBalance);
			// const amountAfterExchangeInUSD = await exchangeRates.effectiveValue(
			// 	pBTC,
			// 	amountAfterExchange,
			// 	pUSD
			// );

			// await periFinance.burnPynths(USDC, toUnit('10'), { from: account1 });
			// await periFinance.burnPynths(PERI, amountAfterExchangeInUSD, { from: account1 });

			// // Get the PERI mintableSupply for week 3
			// // const periodThreeMintableSupply = (await supplySchedule.mintableSupply()).sub(
			// // 	MINTER_PERI_REWARD
			// // );

			// // Mint the staking rewards
			// await periFinance.inflationalMint({ from: minterRole });

			// // Close so we can claim
			// await fastForwardAndCloseFeePeriod();
			// // //////////////////////////////////////////////
			// // 4th Week
			// // //////////////////////////////////////////////

			// // Accounts 2&3 claim rewards
			// await feePool.claimFees({ from: account1 });
			// await feePool.claimFees({ from: account2 });
			// await feePool.claimFees({ from: account3 });

			// await logFeesByPeriod(account1);
			// await logFeesByPeriod(account2);
			// await logFeesByPeriod(account3);
			// await logFeePeriods();

			// Account2 should have 67% of the minted rewards
			// const account2Escrow3 = await rewardEscrow.getVestingEntry(account2, 2); // Account2's 3rd escrow entry
			// console.log('account2Escrow3[1]', account2Escrow3[1].toString());
			// console.log(
			// 	'twoThirds(periodThreeMintableSupply)',
			// 	twoFifths(periodThreeMintableSupply).toString()
			// );
			// assert.bnClose(account2Escrow3[1], twoFifths(periodThreeMintableSupply));
			// assert.bnEqual(account2Escrow3[1], twoFifths(periodThreeMintableSupply));

			// // Account3 should have 33% of the minted rewards
			// const account3Escrow2 = await rewardEscrow.getVestingEntry(account3, 1); // Account3's 2nd escrow entry
			// console.log('account3Escrow3[1]', account3Escrow2[1].toString());
			// console.log(
			// 	'third(periodThreeMintableSupply)',
			// 	oneFifth(periodThreeMintableSupply).toString()
			// );
			// assert.bnClose(account3Escrow2[1], oneFifth(periodThreeMintableSupply), 15);

			// // Acc1 mints 20K (40%) close p (40,40,20)');
			// await periFinance.issuePynths(PERI,twentyK, { from: account1 });

			// // Get the PERI mintableSupply for week 4
			// const periodFourMintableSupply = (await supplySchedule.mintableSupply()).sub(
			// 	MINTER_PERI_REWARD
			// );

			// // Mint the staking rewards
			// await periFinance.inflationalMint({ from: minterRole });

			// // Close so we can claim
			// await fastForwardAndCloseFeePeriod();

			// /// ///////////////////////////////////////////
			// /* 5th Week */
			// /// ///////////////////////////////////////////

			// // Accounts 1,2,3 claim rewards
			// await feePool.claimFees({ from: account1 });
			// await feePool.claimFees({ from: account2 });
			// await feePool.claimFees({ from: account3 });

			// // Assert (1,2,3) have (40%,40%,20%) of the rewards in their 2nd escrow entry
			// const account1EscrowEntry4 = await rewardEscrow.getVestingEntry(account1, 1);
			// const account2EscrowEntry4 = await rewardEscrow.getVestingEntry(account2, 1);
			// const account3EscrowEntry3 = await rewardEscrow.getVestingEntry(account3, 0); // Account3's first escrow entry
			// console.log('account1EscrowEntry4[1]', account1EscrowEntry4[1].toString());
			// console.log('account1EscrowEntry4[1]', account2EscrowEntry4[1].toString());
			// console.log('account1EscrowEntry4[1]', account3EscrowEntry3[1].toString());

			// assert.bnClose(account1EscrowEntry4[1], twoFifths(periodFourMintableSupply));
			// assert.bnClose(account2EscrowEntry4[1], twoFifths(periodFourMintableSupply));
			// assert.bnClose(account3EscrowEntry3[1], oneFifth(periodFourMintableSupply), 16);
		});
	});

	describe('3 Accounts issue 10K pUSD each in week 1', async () => {
		beforeEach(async () => {
			await periFinance.issuePynths(PERI, tenK, { from: account1 });
			await periFinance.issuePynths(PERI, tenK, { from: account2 });
			await periFinance.issuePynths(PERI, tenK, { from: account3 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account2 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account3 });

			// await fastForwardAndCloseFeePeriod();
		});

		it('Acc1 issues and burns multiple times and should have accounts 1,2,3 rewards 50%,25%,25%', async () => {
			// Acc 1 Issues 20K pUSD
			await periFinance.issuePynths(PERI, tenK, { from: account1 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });

			// Close week 2
			await fastForwardAndCloseFeePeriod();
			// await logFeesByPeriod(account1);
			// await logFeesByPeriod(account2);
			// await logFeesByPeriod(account3);

			// //////////////////////////////////////////////
			// 3rd Week
			// //////////////////////////////////////////////

			// Accounts 1,2,3 claim rewards
			await feePool.claimFees({ from: account1 });
			await feePool.claimFees({ from: account2 });
			await feePool.claimFees({ from: account3 });

			// Assert Accounts 1 has 50% & 2&3 have 25% of the minted rewards in their initial escrow entry
			const account1Escrow = await rewardEscrow.getVestingEntry(account1, 1);
			const account2Escrow = await rewardEscrow.getVestingEntry(account2, 2);
			const account3Escrow = await rewardEscrow.getVestingEntry(account3, 3);
			// console.log('account1Escrow[3]', account1Escrow[3].toString());
			// console.log('account2Escrow[3]', account2Escrow[3].toString());
			// console.log('account3Escrow[3]', account3Escrow[3].toString());
			// console.log(
			// 	'half(periodOneMintableSupplyMinusMinterReward',
			// 	half(periodOneMintableSupplyMinusMinterReward).toString()
			// );
			// console.log(
			// 	'quarter(periodOneMintableSupplyMinusMinterReward)',
			// 	quarter(periodOneMintableSupplyMinusMinterReward).toString()
			// );
			assert.bnClose(
				account1Escrow.escrowAmount,
				half(periodOneMintableSupplyMinusMinterReward),
				49
			);
			assert.bnClose(
				account2Escrow.escrowAmount,
				quarter(periodOneMintableSupplyMinusMinterReward),
				26
			);
			assert.bnClose(
				account3Escrow.escrowAmount,
				quarter(periodOneMintableSupplyMinusMinterReward),
				24
			);
			// Acc1 Burns all
			await periFinance.burnPynths(USDC, toUnit('20'), { from: account1 });
			await periFinance.burnPynths(PERI, twentyK, { from: account1 });
			// Acc 1 Issues 10K pUSD
			await periFinance.issuePynths(PERI, tenK, { from: account1 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });
			// Acc 1 Issues 10K pUSD again
			await periFinance.issuePynths(PERI, tenK, { from: account1 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });

			// Get the PERI mintableSupply for week 2
			const periodTwoMintableSupply = (await supplySchedule.mintableSupply()).sub(
				MINTER_PERI_REWARD
			);

			// Mint the staking rewards
			await periFinance.inflationalMint({ from: minterRole });

			// Close week 3
			await fastForwardAndCloseFeePeriod();

			// //////////////////////////////////////////////
			// 3rd Week
			// //////////////////////////////////////////////

			// await logFeePeriods();
			// await logFeesByPeriod(account1);
			// await logFeesByPeriod(account2);
			// await logFeesByPeriod(account3);

			// Accounts 1,2,3 claim rewards
			await feePool.claimFees({ from: account1 });
			await feePool.claimFees({ from: account2 });
			await feePool.claimFees({ from: account3 });

			// Assert Accounts 2&3 have 25% of the minted rewards in their initial escrow entry
			const account1Escrow2 = await rewardEscrow.getVestingEntry(account1, 4);
			const account2Escrow2 = await rewardEscrow.getVestingEntry(account2, 5);
			const account3Escrow2 = await rewardEscrow.getVestingEntry(account3, 6);
			// console.log(`account1Escrow2.escrowAmount: ${account1Escrow2.escrowAmount}`);
			// console.log(`account2Escrow2.escrowAmount: ${account2Escrow2.escrowAmount}`);
			// console.log(`account3Escrow2.escrowAmount: ${account3Escrow2.escrowAmount}`);
			// console.log('half(periodTwoMintableSupply', half(periodTwoMintableSupply).toString());
			// console.log('quarter(periodTwoMintableSupply)', quarter(periodTwoMintableSupply).toString());
			assert.bnClose(account1Escrow2.escrowAmount, half(periodTwoMintableSupply), 49);
			assert.bnClose(account2Escrow2.escrowAmount, quarter(periodTwoMintableSupply), 26);
			assert.bnClose(account3Escrow2.escrowAmount, quarter(periodTwoMintableSupply), 24);
		});
	});

	describe('Collateralisation Ratio Penalties', async () => {
		beforeEach(async () => {
			// console.log('3 accounts issuePynthsAndStakeUSDC toUnit('1000'), toUnit('10'), in p1');
			await periFinance.issuePynths(PERI, toUnit('1000'), { from: account1 });
			await periFinance.issuePynths(PERI, toUnit('1000'), { from: account2 });
			await periFinance.issuePynths(PERI, toUnit('1000'), { from: account3 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account1 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account2 });
			await periFinance.issuePynths(USDC, toUnit('10'), { from: account3 });

			// We should have zero rewards available because the period is still open.
			const rewardsBefore = await feePool.feesAvailable(account1);
			assert.bnEqual(rewardsBefore[1], 0);

			// Once the fee period is closed we should have 1/3 the rewards available because we have
			// 1/3 the collateral backing up the system.
			await fastForwardAndCloseFeePeriod();
			const rewardsAfter = await feePool.feesAvailable(account1);
			// console.log('rewardsAfter', rewardsAfter[1].toString());
			assert.bnClose(rewardsAfter[1], third(periodOneMintableSupplyMinusMinterReward));
		});

		it('should apply no penalty when users claim rewards above the penalty threshold ratio of 1%', async () => {
			// Decrease PERI collateral price by .9%
			const currentRate = await exchangeRates.rateForCurrency(PERI);
			const newRate = currentRate.sub(multiplyDecimal(currentRate, toUnit('0.009')));

			const timestamp = await currentTime();
			await exchangeRates.updateRates([PERI], [newRate], timestamp, {
				from: oracle,
			});

			// we will be able to claim fees
			assert.equal(await feePool.isFeesClaimable(account1), true);

			const periRewards = await feePool.feesAvailable(account1);
			assert.bnClose(periRewards[1], third(periodOneMintableSupplyMinusMinterReward));

			// And if we claim them
			await feePool.claimFees({ from: account1 });

			// We should have our decreased rewards amount in escrow
			const vestingScheduleEntry = await rewardEscrow.getVestingEntry(account1, 1);
			assert.bnClose(
				vestingScheduleEntry.escrowAmount,
				third(periodOneMintableSupplyMinusMinterReward),
				2
			);
		});
		it('should block user from claiming fees and rewards when users claim rewards >10% threshold collateralisation ratio', async () => {
			// unstake all staked USDC and issueMaxPynths with PERI
			const USDCbalanceOfAccount1 = await stakingState.stakedAmountOf(USDC, account1);
			const maxBurnablePynthUSDC = multiplyDecimalRound(
				multiplyDecimalRound(USDCbalanceOfAccount1, await exchangeRates.rateForCurrency(USDC)),
				await systemSettings.issuanceRatio()
			);

			// await periFinance.burnPynths(USDC, USDCbalanceOfAccount1, { from: account1 });
			await periFinance.burnPynths(USDC, maxBurnablePynthUSDC, {
				from: account1,
			});

			const alreadyIssued = await issuer.debtBalanceOf(account1, pUSD);
			const maxIssuablePynthForAccount1 = await issuer.maxIssuablePynths(account1);

			await periFinance.issuePynths(PERI, maxIssuablePynthForAccount1.sub(alreadyIssued), {
				from: account1,
			});

			// But if the price of PERI decreases a lot...
			const newRate = (await exchangeRates.rateForCurrency(PERI)).sub(toUnit('0.09'));
			const timestamp = await currentTime();
			await exchangeRates.updateRates([PERI], [newRate], timestamp, {
				from: oracle,
			});

			// we will fall into the >100% bracket
			assert.equal(await feePool.isFeesClaimable(account1), false);

			// And if we claim then it should revert as there is nothing to claim
			await assert.revert(feePool.claimFees({ from: account1 }));
		});
	});

	describe('When user is the last to call claimFees()', () => {
		beforeEach(async () => {
			const oneThousand = toUnit('1000');
			const twoHundred = toUnit('200');
			await periFinance.issuePynths(PERI, oneThousand, { from: account2 });
			await periFinance.issuePynths(USDC, twoHundred, { from: account2 });
			await periFinance.issuePynths(PERI, oneThousand, { from: account1 });
			await periFinance.issuePynths(USDC, twoHundred, { from: account1 });

			await periFinance.exchange(pUSD, oneThousand, pAUD, { from: account2 });
			await periFinance.exchange(pUSD, oneThousand, pAUD, { from: account1 });

			await fastForwardAndCloseFeePeriod();
		});

		it.skip('then account gets remainder of fees/rewards available after wei rounding', async () => {
			// Assert that we have correct values in the fee pool
			const feesAvailableUSD = await feePool.feesAvailable(account2);
			const oldpUSDBalance = await pUSDContract.balanceOf(account2);

			// Now we should be able to claim them.
			const claimFeesTx = await feePool.claimFees({ from: account2 });
			assert.eventEqual(claimFeesTx, 'FeesClaimed', {
				pUSDAmount: feesAvailableUSD[0],
				periRewards: feesAvailableUSD[1],
			});

			const newUSDBalance = await pUSDContract.balanceOf(account2);
			// We should have our fees
			assert.bnEqual(newUSDBalance, oldpUSDBalance.add(feesAvailableUSD[0]));

			const period = await feePool.recentFeePeriods(1);
			period.index = 1;

			// Simulate rounding on pUSD leaving fraction less for the last claimer.
			// No need to simulate for PERI as the 1.44M PERI has a 1 wei rounding already
			period.feesClaimed = period.feesClaimed.add(toUnit('0.000000000000000001'));
			await feePool.importFeePeriod(
				period.index,
				period.feePeriodId,
				period.startingDebtIndex,
				period.startTime,
				period.feesToDistribute,
				period.feesClaimed,
				period.rewardsToDistribute,
				period.rewardsClaimed,
				{ from: owner }
			);

			const feesAvailableUSDAcc1 = await feePool.feesAvailable(account1);

			// last claimer should get the fraction less
			// is entitled to 721,053.846153846153846154 PERI
			// however only   721,053.846153846153846153 Claimable after rounding to 18 decimals
			const transaction = await feePool.claimFees({ from: account1 });
			assert.eventEqual(transaction, 'FeesClaimed', {
				pUSDAmount: feesAvailableUSDAcc1[0].sub(toUnit('0.000000000000000001')),
				periRewards: feesAvailableUSDAcc1[1],
			});
		});
	});
});
