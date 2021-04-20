## `EtherCollateral`

### `pETHRateNotInvalid()`

### `constructor(address _owner, address _resolver)` (public)

### `setCollateralizationRatio(uint256 ratio)` (external)

### `setInterestRate(uint256 _interestRate)` (external)

### `setIssueFeeRate(uint256 _issueFeeRate)` (external)

### `setIssueLimit(uint256 _issueLimit)` (external)

### `setMinLoanSize(uint256 _minLoanSize)` (external)

### `setAccountLoanLimit(uint256 _loanLimit)` (external)

### `setLoanLiquidationOpen(bool _loanLiquidationOpen)` (external)

### `resolverAddressesRequired() → bytes32[] addresses` (public)

### `getContractInfo() → uint256 _collateralizationRatio, uint256 _issuanceRatio, uint256 _interestRate, uint256 _interestPerSecond, uint256 _issueFeeRate, uint256 _issueLimit, uint256 _minLoanSize, uint256 _totalIssuedPynths, uint256 _totalLoansCreated, uint256 _totalOpenLoanCount, uint256 _ethBalance, uint256 _liquidationDeadline, bool _loanLiquidationOpen` (external)

### `issuanceRatio() → uint256` (public)

### `loanAmountFromCollateral(uint256 collateralAmount) → uint256` (public)

### `collateralAmountForLoan(uint256 loanAmount) → uint256` (external)

### `currentInterestOnLoan(address _account, uint256 _loanID) → uint256` (external)

### `accruedInterestOnLoan(uint256 _loanAmount, uint256 _seconds) → uint256 interestAmount` (public)

### `calculateMintingFee(address _account, uint256 _loanID) → uint256` (external)

### `openLoanIDsByAccount(address _account) → uint256[]` (external)

### `getLoan(address _account, uint256 _loanID) → address account, uint256 collateralAmount, uint256 loanAmount, uint256 timeCreated, uint256 loanID, uint256 timeClosed, uint256 interest, uint256 totalFees` (external)

### `loanLifeSpan(address _account, uint256 _loanID) → uint256 loanLifeSpanResult` (external)

### `openLoan() → uint256 loanID` (external)

### `closeLoan(uint256 loanID)` (external)

### `liquidateUnclosedLoan(address _loanCreatorsAddress, uint256 _loanID)` (external)

### `systemStatus() → contract ISystemStatus` (internal)

### `pynthpETH() → contract IPynth` (internal)

### `pynthpUSD() → contract IPynth` (internal)

### `depot() → contract IDepot` (internal)

### `exchangeRates() → contract IExchangeRates` (internal)

### `CollateralizationRatioUpdated(uint256 ratio)`

### `InterestRateUpdated(uint256 interestRate)`

### `IssueFeeRateUpdated(uint256 issueFeeRate)`

### `IssueLimitUpdated(uint256 issueLimit)`

### `MinLoanSizeUpdated(uint256 minLoanSize)`

### `AccountLoanLimitUpdated(uint256 loanLimit)`

### `LoanLiquidationOpenUpdated(bool loanLiquidationOpen)`

### `LoanCreated(address account, uint256 loanID, uint256 amount)`

### `LoanClosed(address account, uint256 loanID, uint256 feesPaid)`

### `LoanLiquidated(address account, uint256 loanID, address liquidator)`
