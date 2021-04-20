## `IBinaryOptionMarket`

### `options() → contract IBinaryOption long, contract IBinaryOption short` (external)

### `prices() → uint256 long, uint256 short` (external)

### `times() → uint256 biddingEnd, uint256 maturity, uint256 destructino` (external)

### `oracleDetails() → bytes32 key, uint256 strikePrice, uint256 finalPrice` (external)

### `fees() → uint256 poolFee, uint256 creatorFee, uint256 refundFee` (external)

### `creatorLimits() → uint256 capitalRequirement, uint256 skewLimit` (external)

### `deposited() → uint256` (external)

### `creator() → address` (external)

### `resolved() → bool` (external)

### `refundsEnabled() → bool` (external)

### `phase() → enum IBinaryOptionMarket.Phase` (external)

### `oraclePriceAndTimestamp() → uint256 price, uint256 updatedAt` (external)

### `canResolve() → bool` (external)

### `result() → enum IBinaryOptionMarket.Side` (external)

### `pricesAfterBidOrRefund(enum IBinaryOptionMarket.Side side, uint256 value, bool refund) → uint256 long, uint256 short` (external)

### `bidOrRefundForPrice(enum IBinaryOptionMarket.Side bidSide, enum IBinaryOptionMarket.Side priceSide, uint256 price, bool refund) → uint256` (external)

### `bidsOf(address account) → uint256 long, uint256 short` (external)

### `totalBids() → uint256 long, uint256 short` (external)

### `claimableBalancesOf(address account) → uint256 long, uint256 short` (external)

### `totalClaimableSupplies() → uint256 long, uint256 short` (external)

### `balancesOf(address account) → uint256 long, uint256 short` (external)

### `totalSupplies() → uint256 long, uint256 short` (external)

### `exercisableDeposits() → uint256` (external)

### `bid(enum IBinaryOptionMarket.Side side, uint256 value)` (external)

### `refund(enum IBinaryOptionMarket.Side side, uint256 value) → uint256 refundMinusFee` (external)

### `claimOptions() → uint256 longClaimed, uint256 shortClaimed` (external)

### `exerciseOptions() → uint256` (external)
