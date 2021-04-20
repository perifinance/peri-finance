## `BinaryOptionMarket`

### `duringBidding()`

### `afterBidding()`

### `afterMaturity()`

### `systemActive()`

### `managerNotPaused()`

### `constructor(address _owner, address _creator, address _resolver, uint256[2] _creatorLimits, bytes32 _oracleKey, uint256 _strikePrice, bool _refundsEnabled, uint256[3] _times, uint256[2] _bids, uint256[3] _fees)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `_systemStatus() → contract ISystemStatus` (internal)

### `_exchangeRates() → contract IExchangeRates` (internal)

### `_pUSD() → contract IERC20` (internal)

### `_feePool() → contract IFeePool` (internal)

### `_manager() → contract BinaryOptionMarketManager` (internal)

### `_biddingEnded() → bool` (internal)

### `_matured() → bool` (internal)

### `_expired() → bool` (internal)

### `phase() → enum IBinaryOptionMarket.Phase` (external)

### `_oraclePriceAndTimestamp() → uint256 price, uint256 updatedAt` (internal)

### `oraclePriceAndTimestamp() → uint256 price, uint256 updatedAt` (external)

### `_isFreshPriceUpdateTime(uint256 timestamp) → bool` (internal)

### `canResolve() → bool` (external)

### `_result() → enum IBinaryOptionMarket.Side` (internal)

### `result() → enum IBinaryOptionMarket.Side` (external)

### `_computePrices(uint256 longBids, uint256 shortBids, uint256 _deposited) → uint256 long, uint256 short` (internal)

### `senderPriceAndExercisableDeposits() → uint256 price, uint256 exercisable` (external)

### `pricesAfterBidOrRefund(enum IBinaryOptionMarket.Side side, uint256 value, bool refund) → uint256 long, uint256 short` (external)

### `bidOrRefundForPrice(enum IBinaryOptionMarket.Side bidSide, enum IBinaryOptionMarket.Side priceSide, uint256 price, bool refund) → uint256` (external)

### `_bidsOf(address account) → uint256 long, uint256 short` (internal)

### `bidsOf(address account) → uint256 long, uint256 short` (external)

### `_totalBids() → uint256 long, uint256 short` (internal)

### `totalBids() → uint256 long, uint256 short` (external)

### `_claimableBalancesOf(address account) → uint256 long, uint256 short` (internal)

### `claimableBalancesOf(address account) → uint256 long, uint256 short` (external)

### `totalClaimableSupplies() → uint256 long, uint256 short` (external)

### `_balancesOf(address account) → uint256 long, uint256 short` (internal)

### `balancesOf(address account) → uint256 long, uint256 short` (external)

### `totalSupplies() → uint256 long, uint256 short` (external)

### `_exercisableDeposits(uint256 _deposited) → uint256` (internal)

### `exercisableDeposits() → uint256` (external)

### `_chooseSide(enum IBinaryOptionMarket.Side side, uint256 longValue, uint256 shortValue) → uint256` (internal)

### `_option(enum IBinaryOptionMarket.Side side) → contract BinaryOption` (internal)

### `_subToZero(uint256 a, uint256 b) → uint256` (internal)

### `_checkCreatorLimits(uint256 longBid, uint256 shortBid)` (internal)

### `_incrementDeposited(uint256 value) → uint256 _deposited` (internal)

### `_decrementDeposited(uint256 value) → uint256 _deposited` (internal)

### `_requireManagerNotPaused()` (internal)

### `requireActiveAndUnpaused()` (external)

### `_updatePrices(uint256 longBids, uint256 shortBids, uint256 _deposited)` (internal)

### `bid(enum IBinaryOptionMarket.Side side, uint256 value)` (external)

### `refund(enum IBinaryOptionMarket.Side side, uint256 value) → uint256 refundMinusFee` (external)

### `resolve()` (external)

### `_claimOptions() → uint256 longClaimed, uint256 shortClaimed` (internal)

### `claimOptions() → uint256 longClaimed, uint256 shortClaimed` (external)

### `exerciseOptions() → uint256` (external)

### `_selfDestruct(address payable beneficiary)` (internal)

### `cancel(address payable beneficiary)` (external)

### `expire(address payable beneficiary)` (external)

### `Bid(enum IBinaryOptionMarket.Side side, address account, uint256 value)`

### `Refund(enum IBinaryOptionMarket.Side side, address account, uint256 value, uint256 fee)`

### `PricesUpdated(uint256 longPrice, uint256 shortPrice)`

### `MarketResolved(enum IBinaryOptionMarket.Side result, uint256 oraclePrice, uint256 oracleTimestamp, uint256 deposited, uint256 poolFees, uint256 creatorFees)`

### `OptionsClaimed(address account, uint256 longOptions, uint256 shortOptions)`

### `OptionsExercised(address account, uint256 value)`
