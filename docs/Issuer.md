## `Issuer`

### `onlyPeriFinance()`

### `constructor(address _owner, address _resolver)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `periFinance() → contract IPeriFinance` (internal)

### `usdcState() → contract IStakeStateUSDC` (internal)

### `usdc() → contract IERC20` (internal)

### `exchanger() → contract IExchanger` (internal)

### `exchangeRates() → contract IExchangeRates` (internal)

### `periFinanceState() → contract IPeriFinanceState` (internal)

### `feePool() → contract IFeePool` (internal)

### `liquidations() → contract ILiquidations` (internal)

### `delegateApprovals() → contract IDelegateApprovals` (internal)

### `etherCollateral() → contract IEtherCollateral` (internal)

### `etherCollateralpUSD() → contract IEtherCollateralpUSD` (internal)

### `collateralManager() → contract ICollateralManager` (internal)

### `rewardEscrowV2() → contract IRewardEscrowV2` (internal)

### `periFinanceEscrow() → contract IHasBalance` (internal)

### `debtCache() → contract IIssuerInternalDebtCache` (internal)

### `issuanceRatio() → uint256` (external)

### `_availableCurrencyKeysWithOptionalPERI(bool withPERI) → bytes32[]` (internal)

### `_totalIssuedPynths(bytes32 currencyKey, bool excludeCollateral) → uint256 totalIssued, bool anyRateIsInvalid` (internal)

### `_debtBalanceOfAndTotalDebt(address _issuer, bytes32 currencyKey) → uint256 debtBalance, uint256 totalSystemValue, bool anyRateIsInvalid` (internal)

### `_canBurnPynths(address account) → bool` (internal)

### `_lastIssueEvent(address account) → uint256` (internal)

### `_remainingIssuablePynths(address _issuer) → uint256 maxIssuable, uint256 alreadyIssued, uint256 totalSystemDebt, bool anyRateIsInvalid` (internal)

### `_periToUSD(uint256 amount, uint256 periRate) → uint256` (internal)

### `_usdToPeri(uint256 amount, uint256 periRate) → uint256` (internal)

### `_maxIssuablePynths(address _issuer) → uint256, bool` (internal)

### `_collateralisationRatio(address _issuer) → uint256, bool` (internal)

### `_collateral(address account) → uint256` (internal)

### `minimumStakeTime() → uint256` (external)

### `canBurnPynths(address account) → bool` (external)

### `availableCurrencyKeys() → bytes32[]` (external)

### `availablePynthCount() → uint256` (external)

### `anyPynthOrPERIRateIsInvalid() → bool anyRateInvalid` (external)

### `totalIssuedPynths(bytes32 currencyKey, bool excludeEtherCollateral) → uint256 totalIssued` (external)

### `lastIssueEvent(address account) → uint256` (external)

### `collateralisationRatio(address _issuer) → uint256 cratio` (external)

### `collateralisationRatioAndAnyRatesInvalid(address _issuer) → uint256 cratio, bool anyRateIsInvalid` (external)

### `collateral(address account) → uint256` (external)

### `debtBalanceOf(address _issuer, bytes32 currencyKey) → uint256 debtBalance` (external)

### `remainingIssuablePynths(address _issuer) → uint256 maxIssuable, uint256 alreadyIssued, uint256 totalSystemDebt` (external)

### `maxIssuablePynths(address _issuer) → uint256` (external)

### `transferablePeriFinanceAndAnyRateIsInvalid(address account, uint256 balance) → uint256 transferable, bool anyRateIsInvalid` (external)

### `getPynths(bytes32[] currencyKeys) → contract IPynth[]` (external)

### `_addPynth(contract IPynth pynth)` (internal)

### `addPynth(contract IPynth pynth)` (external)

### `addPynths(contract IPynth[] pynthsToAdd)` (external)

### `_removePynth(bytes32 currencyKey)` (internal)

### `removePynth(bytes32 currencyKey)` (external)

### `removePynths(bytes32[] currencyKeys)` (external)

### `issuePynths(address from, uint256 amount)` (external)

### `issuePynthsUsdc(address from, uint256 amount)` (external)

### `issueMaxPynths(address from)` (external)

### `issuePynthsOnBehalf(address issueForAddress, address from, uint256 amount)` (external)

### `issueMaxPynthsOnBehalf(address issueForAddress, address from)` (external)

### `burnPynths(address from, uint256 amount)` (external)

### `burnPynthsOnBehalf(address burnForAddress, address from, uint256 amount)` (external)

### `burnPynthsToTarget(address from)` (external)

### `burnPynthsToTargetOnBehalf(address burnForAddress, address from)` (external)

### `liquidateDelinquentAccount(address account, uint256 pusdAmount, address liquidator) → uint256 totalRedeemed, uint256 amountToLiquidate` (external)

### `_requireRatesNotInvalid(bool anyRateIsInvalid)` (internal)

### `_requireCanIssueOnBehalf(address issueForAddress, address from)` (internal)

### `_requireCanBurnOnBehalf(address burnForAddress, address from)` (internal)

### `_issuePynths(address from, uint256 amount, bool issueMax)` (internal)

### `_burnPynths(address debtAccount, address burnAccount, uint256 amount, uint256 existingDebt, uint256 totalDebtIssued) → uint256 amountBurnt` (internal)

### `_issuePynthsUsdc(address from, uint256 amount)` (internal)

### `_voluntaryBurnPynths(address from, uint256 amount, bool burnToTarget)` (internal)

### `_setLastIssueEvent(address account)` (internal)

### `_appendAccountIssuanceRecord(address from)` (internal)

### `_addToDebtRegister(address from, uint256 amount, uint256 existingDebt, uint256 totalDebtIssued)` (internal)

### `_removeFromDebtRegister(address from, uint256 debtToRemove, uint256 existingDebt, uint256 totalDebtIssued)` (internal)

### `_onlyPeriFinance()` (internal)

### `PynthAdded(bytes32 currencyKey, address pynth)`

### `PynthRemoved(bytes32 currencyKey, address pynth)`
