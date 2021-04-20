## `EtherCollateralpUSD`

### `ETHRateNotInvalid()`

### `constructor(address _owner, address _resolver)` (public)

### `setCollateralizationRatio(uint256 ratio)` (external)

### `setInterestRate(uint256 _interestRate)` (external)

### `setIssueFeeRate(uint256 _issueFeeRate)` (external)

### `setIssueLimit(uint256 _issueLimit)` (external)

### `setMinLoanCollateralSize(uint256 _minLoanCollateralSize)` (external)

### `setAccountLoanLimit(uint256 _loanLimit)` (external)

### `setLoanLiquidationOpen(bool _loanLiquidationOpen)` (external)

### `setLiquidationRatio(uint256 _liquidationRatio)` (external)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `getContractInfo() → uint256 _collateralizationRatio, uint256 _issuanceRatio, uint256 _interestRate, uint256 _interestPerSecond, uint256 _issueFeeRate, uint256 _issueLimit, uint256 _minLoanCollateralSize, uint256 _totalIssuedPynths, uint256 _totalLoansCreated, uint256 _totalOpenLoanCount, uint256 _ethBalance, uint256 _liquidationDeadline, bool _loanLiquidationOpen` (external)

### `issuanceRatio() → uint256` (public)

### `loanAmountFromCollateral(uint256 collateralAmount) → uint256` (public)

### `collateralAmountForLoan(uint256 loanAmount) → uint256` (external)

### `currentInterestOnLoan(address _account, uint256 _loanID) → uint256` (external)

### `accruedInterestOnLoan(uint256 _loanAmount, uint256 _seconds) → uint256 interestAmount` (public)

### `totalFeesOnLoan(address _account, uint256 _loanID) → uint256 interestAmount, uint256 mintingFee` (external)

### `getMintingFee(address _account, uint256 _loanID) → uint256` (external)

### `calculateAmountToLiquidate(uint256 debtBalance, uint256 collateral) → uint256` (public)

r = target issuance ratio
D = debt balance
V = Collateral
P = liquidation penalty
Calculates amount of pynths = (D - V _ r) / (1 - (1 + P) _ r)

### `openLoanIDsByAccount(address _account) → uint256[]` (external)

### `getLoan(address _account, uint256 _loanID) → address account, uint256 collateralAmount, uint256 loanAmount, uint256 timeCreated, uint256 loanID, uint256 timeClosed, uint256 accruedInterest, uint256 totalFees` (external)

### `getLoanCollateralRatio(address _account, uint256 _loanID) → uint256 loanCollateralRatio` (external)

### `_loanCollateralRatio(struct EtherCollateralpUSD.PynthLoanStruct _loan) → uint256 loanCollateralRatio, uint256 collateralValue, uint256 interestAmount` (internal)

### `timeSinceInterestAccrualOnLoan(address _account, uint256 _loanID) → uint256` (external)

### `openLoan(uint256 _loanAmount) → uint256 loanID` (external)

### `closeLoan(uint256 loanID)` (external)

### `depositCollateral(address account, uint256 loanID)` (external)

### `withdrawCollateral(uint256 loanID, uint256 withdrawAmount)` (external)

### `repayLoan(address _loanCreatorsAddress, uint256 _loanID, uint256 _repayAmount)` (external)

### `liquidateLoan(address _loanCreatorsAddress, uint256 _loanID, uint256 _debtToCover)` (external)

### `_splitInterestLoanPayment(uint256 _paymentAmount, uint256 _accruedInterest, uint256 _loanAmount) → uint256 interestPaid, uint256 loanAmountPaid, uint256 accruedInterestAfter, uint256 loanAmountAfter` (internal)

### `_processInterestAndLoanPayment(uint256 interestPaid, uint256 loanAmountPaid)` (internal)

### `liquidateUnclosedLoan(address _loanCreatorsAddress, uint256 _loanID)` (external)

### `_checkLoanIsOpen(struct EtherCollateralpUSD.PynthLoanStruct _pynthLoan)` (internal)

### `systemStatus() → contract ISystemStatus` (internal)

### `pynthpUSD() → contract IPynth` (internal)

### `exchangeRates() → contract IExchangeRates` (internal)

### `feePool() → contract IFeePool` (internal)

### `CollateralizationRatioUpdated(uint256 ratio)`

### `LiquidationRatioUpdated(uint256 ratio)`

### `InterestRateUpdated(uint256 interestRate)`

### `IssueFeeRateUpdated(uint256 issueFeeRate)`

### `IssueLimitUpdated(uint256 issueLimit)`

### `MinLoanCollateralSizeUpdated(uint256 minLoanCollateralSize)`

### `AccountLoanLimitUpdated(uint256 loanLimit)`

### `LoanLiquidationOpenUpdated(bool loanLiquidationOpen)`

### `LoanCreated(address account, uint256 loanID, uint256 amount)`

### `LoanClosed(address account, uint256 loanID, uint256 feesPaid)`

### `LoanLiquidated(address account, uint256 loanID, address liquidator)`

### `LoanPartiallyLiquidated(address account, uint256 loanID, address liquidator, uint256 liquidatedAmount, uint256 liquidatedCollateral)`

### `CollateralDeposited(address account, uint256 loanID, uint256 collateralAmount, uint256 collateralAfter)`

### `CollateralWithdrawn(address account, uint256 loanID, uint256 amountWithdrawn, uint256 collateralAfter)`

### `LoanRepaid(address account, uint256 loanID, uint256 repaidAmount, uint256 newLoanAmount)`
