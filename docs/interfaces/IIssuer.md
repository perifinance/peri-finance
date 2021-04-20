## `IIssuer`

### `anyPynthOrPERIRateIsInvalid() → bool anyRateInvalid` (external)

### `availableCurrencyKeys() → bytes32[]` (external)

### `availablePynthCount() → uint256` (external)

### `availablePynths(uint256 index) → contract IPynth` (external)

### `canBurnPynths(address account) → bool` (external)

### `collateral(address account) → uint256` (external)

### `collateralisationRatio(address issuer) → uint256` (external)

### `collateralisationRatioAndAnyRatesInvalid(address _issuer) → uint256 cratio, bool anyRateIsInvalid` (external)

### `debtBalanceOf(address issuer, bytes32 currencyKey) → uint256 debtBalance` (external)

### `issuanceRatio() → uint256` (external)

### `lastIssueEvent(address account) → uint256` (external)

### `maxIssuablePynths(address issuer) → uint256 maxIssuable` (external)

### `minimumStakeTime() → uint256` (external)

### `remainingIssuablePynths(address issuer) → uint256 maxIssuable, uint256 alreadyIssued, uint256 totalSystemDebt` (external)

### `pynths(bytes32 currencyKey) → contract IPynth` (external)

### `getPynths(bytes32[] currencyKeys) → contract IPynth[]` (external)

### `pynthsByAddress(address pynthAddress) → bytes32` (external)

### `totalIssuedPynths(bytes32 currencyKey, bool excludeEtherCollateral) → uint256` (external)

### `transferablePeriFinanceAndAnyRateIsInvalid(address account, uint256 balance) → uint256 transferable, bool anyRateIsInvalid` (external)

### `issuePynths(address from, uint256 amount)` (external)

### `issuePynthsUsdc(address from, uint256 amount)` (external)

### `issuePynthsOnBehalf(address issueFor, address from, uint256 amount)` (external)

### `issueMaxPynths(address from)` (external)

### `issueMaxPynthsOnBehalf(address issueFor, address from)` (external)

### `burnPynths(address from, uint256 amount)` (external)

### `burnPynthsOnBehalf(address burnForAddress, address from, uint256 amount)` (external)

### `burnPynthsToTarget(address from)` (external)

### `burnPynthsToTargetOnBehalf(address burnForAddress, address from)` (external)

### `liquidateDelinquentAccount(address account, uint256 pusdAmount, address liquidator) → uint256 totalRedeemed, uint256 amountToLiquidate` (external)
