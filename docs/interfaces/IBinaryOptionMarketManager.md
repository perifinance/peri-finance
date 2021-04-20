## `IBinaryOptionMarketManager`

### `fees() → uint256 poolFee, uint256 creatorFee, uint256 refundFee` (external)

### `durations() → uint256 maxOraclePriceAge, uint256 expiryDuration, uint256 maxTimeToMaturity` (external)

### `creatorLimits() → uint256 capitalRequirement, uint256 skewLimit` (external)

### `marketCreationEnabled() → bool` (external)

### `totalDeposited() → uint256` (external)

### `numActiveMarkets() → uint256` (external)

### `activeMarkets(uint256 index, uint256 pageSize) → address[]` (external)

### `numMaturedMarkets() → uint256` (external)

### `maturedMarkets(uint256 index, uint256 pageSize) → address[]` (external)

### `createMarket(bytes32 oracleKey, uint256 strikePrice, bool refundsEnabled, uint256[2] times, uint256[2] bids) → contract IBinaryOptionMarket` (external)

### `resolveMarket(address market)` (external)

### `cancelMarket(address market)` (external)

### `expireMarkets(address[] market)` (external)
