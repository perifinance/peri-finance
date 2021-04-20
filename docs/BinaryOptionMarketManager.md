## `BinaryOptionMarketManager`

### `onlyActiveMarkets()`

### `onlyKnownMarkets()`

### `constructor(address _owner, address _resolver, uint256 _maxOraclePriceAge, uint256 _expiryDuration, uint256 _maxTimeToMaturity, uint256 _creatorCapitalRequirement, uint256 _creatorSkewLimit, uint256 _poolFee, uint256 _creatorFee, uint256 _refundFee)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `_systemStatus() → contract ISystemStatus` (internal)

### `_pUSD() → contract IERC20` (internal)

### `_exchangeRates() → contract IExchangeRates` (internal)

### `_factory() → contract BinaryOptionMarketFactory` (internal)

### `_isKnownMarket(address candidate) → bool` (internal)

### `numActiveMarkets() → uint256` (external)

### `activeMarkets(uint256 index, uint256 pageSize) → address[]` (external)

### `numMaturedMarkets() → uint256` (external)

### `maturedMarkets(uint256 index, uint256 pageSize) → address[]` (external)

### `_isValidKey(bytes32 oracleKey) → bool` (internal)

### `setMaxOraclePriceAge(uint256 _maxOraclePriceAge)` (public)

### `setExpiryDuration(uint256 _expiryDuration)` (public)

### `setMaxTimeToMaturity(uint256 _maxTimeToMaturity)` (public)

### `setPoolFee(uint256 _poolFee)` (public)

### `setCreatorFee(uint256 _creatorFee)` (public)

### `setRefundFee(uint256 _refundFee)` (public)

### `setCreatorCapitalRequirement(uint256 _creatorCapitalRequirement)` (public)

### `setCreatorSkewLimit(uint256 _creatorSkewLimit)` (public)

### `incrementTotalDeposited(uint256 delta)` (external)

### `decrementTotalDeposited(uint256 delta)` (external)

### `createMarket(bytes32 oracleKey, uint256 strikePrice, bool refundsEnabled, uint256[2] times, uint256[2] bids) → contract IBinaryOptionMarket` (external)

### `resolveMarket(address market)` (external)

### `cancelMarket(address market)` (external)

### `expireMarkets(address[] markets)` (external)

### `rebuildMarketCaches(contract BinaryOptionMarket[] marketsToSync)` (external)

### `setMarketCreationEnabled(bool enabled)` (public)

### `setMigratingManager(contract BinaryOptionMarketManager manager)` (public)

### `migrateMarkets(contract BinaryOptionMarketManager receivingManager, bool active, contract BinaryOptionMarket[] marketsToMigrate)` (external)

### `receiveMarkets(bool active, contract BinaryOptionMarket[] marketsToReceive)` (external)

### `MarketCreated(address market, address creator, bytes32 oracleKey, uint256 strikePrice, uint256 biddingEndDate, uint256 maturityDate, uint256 expiryDate)`

### `MarketExpired(address market)`

### `MarketCancelled(address market)`

### `MarketsMigrated(contract BinaryOptionMarketManager receivingManager, contract BinaryOptionMarket[] markets)`

### `MarketsReceived(contract BinaryOptionMarketManager migratingManager, contract BinaryOptionMarket[] markets)`

### `MarketCreationEnabledUpdated(bool enabled)`

### `MaxOraclePriceAgeUpdated(uint256 duration)`

### `ExerciseDurationUpdated(uint256 duration)`

### `ExpiryDurationUpdated(uint256 duration)`

### `MaxTimeToMaturityUpdated(uint256 duration)`

### `CreatorCapitalRequirementUpdated(uint256 value)`

### `CreatorSkewLimitUpdated(uint256 value)`

### `PoolFeeUpdated(uint256 fee)`

### `CreatorFeeUpdated(uint256 fee)`

### `RefundFeeUpdated(uint256 fee)`
