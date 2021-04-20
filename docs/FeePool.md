## `FeePool`

### `onlyInternalContracts()`

### `onlyIssuerAndPeriFinanceState()`

### `notFeeAddress(address account)`

### `issuanceActive()`

### `constructor(address payable _proxy, address _owner, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `systemStatus() → contract ISystemStatus` (internal)

### `periFinance() → contract IPeriFinance` (internal)

### `feePoolState() → contract FeePoolState` (internal)

### `feePoolEternalStorage() → contract FeePoolEternalStorage` (internal)

### `exchanger() → contract IExchanger` (internal)

### `etherCollateralpUSD() → contract IEtherCollateralpUSD` (internal)

### `collateralManager() → contract ICollateralManager` (internal)

### `issuer() → contract IIssuer` (internal)

### `periFinanceState() → contract IPeriFinanceState` (internal)

### `rewardEscrowV2() → contract IRewardEscrowV2` (internal)

### `delegateApprovals() → contract IDelegateApprovals` (internal)

### `rewardsDistribution() → contract IRewardsDistribution` (internal)

### `issuanceRatio() → uint256` (external)

### `feePeriodDuration() → uint256` (external)

### `targetThreshold() → uint256` (external)

### `recentFeePeriods(uint256 index) → uint64 feePeriodId, uint64 startingDebtIndex, uint64 startTime, uint256 feesToDistribute, uint256 feesClaimed, uint256 rewardsToDistribute, uint256 rewardsClaimed` (external)

### `_recentFeePeriodsStorage(uint256 index) → struct FeePool.FeePeriod` (internal)

### `appendAccountIssuanceRecord(address account, uint256 debtRatio, uint256 debtEntryIndex)` (external)

Logs an accounts issuance data per fee period

onlyIssuer to call me on periFinance.issue() & periFinance.burn() calls to store the locked PERI
per fee period so we know to allocate the correct proportions of fees and rewards per period

### `recordFeePaid(uint256 amount)` (external)

The Exchanger contract informs us when fees are paid.

### `setRewardsToDistribute(uint256 amount)` (external)

The RewardsDistribution contract informs us how many PERI rewards are sent to RewardEscrow to be claimed.

### `closeCurrentFeePeriod()` (external)

Close the current fee period and start a new one.

### `claimFees() → bool` (external)

Claim fees for last period when available or not already withdrawn.

### `claimOnBehalf(address claimingForAddress) → bool` (external)

Delegated claimFees(). Call from the deletegated address
and the fees will be sent to the claimingForAddress.
approveClaimOnBehalf() must be called first to approve the deletage address

### `_claimFees(address claimingAddress) → bool` (internal)

### `importFeePeriod(uint256 feePeriodIndex, uint256 feePeriodId, uint256 startingDebtIndex, uint256 startTime, uint256 feesToDistribute, uint256 feesClaimed, uint256 rewardsToDistribute, uint256 rewardsClaimed)` (public)

Admin function to import the FeePeriod data from the previous contract

### `_recordFeePayment(uint256 pUSDAmount) → uint256` (internal)

Record the fee payment in our recentFeePeriods.

### `_recordRewardPayment(uint256 periAmount) → uint256` (internal)

Record the reward payment in our recentFeePeriods.

### `_payFees(address account, uint256 pUSDAmount)` (internal)

Send the fees to claiming address.

### `_payRewards(address account, uint256 periAmount)` (internal)

Send the rewards to claiming address - will be locked in rewardEscrow.

### `totalFeesAvailable() → uint256` (external)

The total fees available in the system to be withdrawnn in pUSD

### `totalRewardsAvailable() → uint256` (external)

The total PERI rewards available in the system to be withdrawn

### `feesAvailable(address account) → uint256, uint256` (public)

The fees available to be withdrawn by a specific account, priced in pUSD

Returns two amounts, one for fees and one for PERI rewards

### `_isFeesClaimableAndAnyRatesInvalid(address account) → bool, bool` (internal)

### `isFeesClaimable(address account) → bool feesClaimable` (external)

### `feesByPeriod(address account) → uint256[2][2] results` (public)

Calculates fees by period for an account, priced in pUSD

### `_feesAndRewardsFromPeriod(uint256 period, uint256 ownershipPercentage, uint256 debtEntryIndex) → uint256, uint256` (internal)

ownershipPercentage is a high precision decimals uint based on
wallet's debtPercentage. Gives a precise amount of the feesToDistribute
for fees in the period. Precision factor is removed before results are
returned.

The reported fees owing for the current period [0] are just a
running balance until the fee period closes

### `_effectiveDebtRatioForPeriod(uint256 closingDebtIndex, uint256 ownershipPercentage, uint256 debtEntryIndex) → uint256` (internal)

### `effectiveDebtRatioForPeriod(address account, uint256 period) → uint256` (external)

### `getLastFeeWithdrawal(address _claimingAddress) → uint256` (public)

Get the feePeriodID of the last claim this account made

### `getPenaltyThresholdRatio() → uint256` (public)

Calculate the collateral ratio before user is blocked from claiming.

### `_setLastFeeWithdrawal(address _claimingAddress, uint256 _feePeriodID)` (internal)

Set the feePeriodID of the last claim this account made

### `emitIssuanceDebtRatioEntry(address account, uint256 debtRatio, uint256 debtEntryIndex, uint256 feePeriodStartingDebtIndex)` (internal)

### `emitFeePeriodClosed(uint256 feePeriodId)` (internal)

### `emitFeesClaimed(address account, uint256 pUSDAmount, uint256 periRewards)` (internal)

### `IssuanceDebtRatioEntry(address account, uint256 debtRatio, uint256 debtEntryIndex, uint256 feePeriodStartingDebtIndex)`

### `FeePeriodClosed(uint256 feePeriodId)`

### `FeesClaimed(address account, uint256 pUSDAmount, uint256 periRewards)`
