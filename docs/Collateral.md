## `Collateral`

### `rateIsValid()`

### `constructor(contract CollateralState _state, address _owner, address _manager, address _resolver, bytes32 _collateralKey, uint256 _minCratio, uint256 _minCollateral)` (public)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `_systemStatus() → contract ISystemStatus` (internal)

### `_pynth(bytes32 pynthName) → contract IPynth` (internal)

### `_pynthpUSD() → contract IPynth` (internal)

### `_exchangeRates() → contract IExchangeRates` (internal)

### `_exchanger() → contract IExchanger` (internal)

### `_feePool() → contract IFeePool` (internal)

### `_manager() → contract ICollateralManager` (internal)

### `collateralRatio(struct ICollateralLoan.Loan loan) → uint256 cratio` (public)

### `maxLoan(uint256 amount, bytes32 currency) → uint256 max` (public)

### `liquidationAmount(struct ICollateralLoan.Loan loan) → uint256 amount` (public)

r = target issuance ratio
D = debt value in pUSD
V = collateral value in pUSD
P = liquidation penalty
Calculates amount of pynths = (D - V _ r) / (1 - (1 + P) _ r)
Note: if you pass a loan in here that is not eligible for liquidation it will revert.
We check the ratio first in liquidateInternal and only pass eligible loans in.

### `collateralRedeemed(bytes32 currency, uint256 amount) → uint256 collateral` (public)

### `arePynthsAndCurrenciesSet(bytes32[] _pynthNamesInResolver, bytes32[] _pynthKeys) → bool` (external)

### `_checkPynthBalance(address payer, bytes32 key, uint256 amount)` (internal)

### `_checkLoanAvailable(struct ICollateralLoan.Loan _loan)` (internal)

### `issuanceRatio() → uint256 ratio` (internal)

### `addPynths(bytes32[] _pynthNamesInResolver, bytes32[] _pynthKeys)` (external)

### `addRewardsContracts(address rewardsContract, bytes32 pynth)` (external)

### `setMinCratio(uint256 _minCratio)` (external)

### `setIssueFeeRate(uint256 _issueFeeRate)` (external)

### `setInteractionDelay(uint256 _interactionDelay)` (external)

### `setManager(address _newManager)` (external)

### `setCanOpenLoans(bool _canOpenLoans)` (external)

### `openInternal(uint256 collateral, uint256 amount, bytes32 currency, bool short) → uint256 id` (internal)

### `closeInternal(address borrower, uint256 id) → uint256 collateral` (internal)

### `closeByLiquidationInternal(address borrower, address liquidator, struct ICollateralLoan.Loan loan) → uint256 collateral` (internal)

### `depositInternal(address account, uint256 id, uint256 amount)` (internal)

### `withdrawInternal(uint256 id, uint256 amount) → uint256 withdraw` (internal)

### `liquidateInternal(address borrower, uint256 id, uint256 payment) → uint256 collateralLiquidated` (internal)

### `repayInternal(address borrower, address repayer, uint256 id, uint256 payment)` (internal)

### `drawInternal(uint256 id, uint256 amount)` (internal)

### `accrueInterest(struct ICollateralLoan.Loan loan) → struct ICollateralLoan.Loan loanAfter` (internal)

### `_processPayment(struct ICollateralLoan.Loan loanBefore, uint256 payment) → struct ICollateralLoan.Loan loanAfter` (internal)

### `_payFees(uint256 amount, bytes32 pynth)` (internal)

### `MinCratioRatioUpdated(uint256 minCratio)`

### `MinCollateralUpdated(uint256 minCollateral)`

### `IssueFeeRateUpdated(uint256 issueFeeRate)`

### `MaxLoansPerAccountUpdated(uint256 maxLoansPerAccount)`

### `InteractionDelayUpdated(uint256 interactionDelay)`

### `ManagerUpdated(address manager)`

### `CanOpenLoansUpdated(bool canOpenLoans)`

### `LoanCreated(address account, uint256 id, uint256 amount, uint256 collateral, bytes32 currency, uint256 issuanceFee)`

### `LoanClosed(address account, uint256 id)`

### `CollateralDeposited(address account, uint256 id, uint256 amountDeposited, uint256 collateralAfter)`

### `CollateralWithdrawn(address account, uint256 id, uint256 amountWithdrawn, uint256 collateralAfter)`

### `LoanRepaymentMade(address account, address repayer, uint256 id, uint256 amountRepaid, uint256 amountAfter)`

### `LoanDrawnDown(address account, uint256 id, uint256 amount)`

### `LoanPartiallyLiquidated(address account, uint256 id, address liquidator, uint256 amountLiquidated, uint256 collateralLiquidated)`

### `LoanClosedByLiquidation(address account, uint256 id, address liquidator, uint256 amountLiquidated, uint256 collateralLiquidated)`
