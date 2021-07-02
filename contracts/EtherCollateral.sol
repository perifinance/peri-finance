pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./Pausable.sol";
import "openzeppelin-solidity-2.3.0/contracts/utils/ReentrancyGuard.sol";
import "./MixinResolver.sol";
import "./interfaces/IEtherCollateral.sol";

// Libraries
import "./SafeDecimalMath.sol";

// Internal references
import "./interfaces/ISystemStatus.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IPynth.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IDepot.sol";
import "./interfaces/IExchangeRates.sol";

// https://docs.peri.finance/contracts/source/contracts/ethercollateral
contract EtherCollateral is Owned, Pausable, ReentrancyGuard, MixinResolver, IEtherCollateral {
    using SafeMath for uint256;
    using SafeDecimalMath for uint256;

    // ========== CONSTANTS ==========
    uint256 internal constant ONE_THOUSAND = 1e18 * 1000;
    uint256 internal constant ONE_HUNDRED = 1e18 * 100;

    uint256 internal constant SECONDS_IN_A_YEAR = 31536000; // Common Year

    // Where fees are pooled in pUSD.
    address internal constant FEE_ADDRESS = 0xfeEFEEfeefEeFeefEEFEEfEeFeefEEFeeFEEFEeF;

    // ========== SETTER STATE VARIABLES ==========

    // The ratio of Collateral to pynths issued
    uint256 public collateralizationRatio = SafeDecimalMath.unit() * 125; // SCCP-27

    // If updated, all outstanding loans will pay this interest rate in on closure of the loan. Default 5%
    uint256 public interestRate = (5 * SafeDecimalMath.unit()) / 100;
    uint256 public interestPerSecond = interestRate.div(SECONDS_IN_A_YEAR);

    // Minting fee for issuing the pynths. Default 50 bips.
    uint256 public issueFeeRate = (5 * SafeDecimalMath.unit()) / 1000;

    // Maximum amount of pETH that can be issued by the EtherCollateral contract. Default 5000
    uint256 public issueLimit = SafeDecimalMath.unit() * 5000;

    // Minimum amount of ETH to create loan preventing griefing and gas consumption. Min 1ETH = 0.8 pETH
    uint256 public minLoanSize = SafeDecimalMath.unit() * 1;

    // Maximum number of loans an account can create
    uint256 public accountLoanLimit = 50;

    // If true then any wallet addres can close a loan not just the loan creator.
    bool public loanLiquidationOpen = false;

    // Time when remaining loans can be liquidated
    uint256 public liquidationDeadline;

    // ========== STATE VARIABLES ==========

    // The total number of pynths issued by the collateral in this contract
    uint256 public totalIssuedPynths;

    // Total number of loans ever created
    uint256 public totalLoansCreated;

    // Total number of open loans
    uint256 public totalOpenLoanCount;

    // Pynth loan storage struct
    struct PynthLoanStruct {
        //  Acccount that created the loan
        address account;
        //  Amount (in collateral token ) that they deposited
        uint256 collateralAmount;
        //  Amount (in pynths) that they issued to borrow
        uint256 loanAmount;
        // When the loan was created
        uint256 timeCreated;
        // ID for the loan
        uint256 loanID;
        // When the loan was paidback (closed)
        uint256 timeClosed;
    }

    // Users Loans by address
    mapping(address => PynthLoanStruct[]) public accountsPynthLoans;

    // Account Open Loan Counter
    mapping(address => uint256) public accountOpenLoanCounter;

    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_SYSTEMSTATUS = "SystemStatus";
    bytes32 private constant CONTRACT_PYNTHPETH = "PynthpETH";
    bytes32 private constant CONTRACT_PYNTHPUSD = "PynthpUSD";
    bytes32 private constant CONTRACT_DEPOT = "Depot";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";

    // ========== CONSTRUCTOR ==========
    constructor(address _owner, address _resolver) public Owned(_owner) Pausable() MixinResolver(_resolver) {
        liquidationDeadline = now + 92 days; // Time before loans can be liquidated
    }

    // ========== SETTERS ==========

    function setCollateralizationRatio(uint256 ratio) external onlyOwner {
        require(ratio <= ONE_THOUSAND, "Too high");
        require(ratio >= ONE_HUNDRED, "Too low");
        collateralizationRatio = ratio;
        emit CollateralizationRatioUpdated(ratio);
    }

    function setInterestRate(uint256 _interestRate) external onlyOwner {
        require(_interestRate > SECONDS_IN_A_YEAR, "Interest rate cannot be less that the SECONDS_IN_A_YEAR");
        require(_interestRate <= SafeDecimalMath.unit(), "Interest cannot be more than 100% APR");
        interestRate = _interestRate;
        interestPerSecond = _interestRate.div(SECONDS_IN_A_YEAR);
        emit InterestRateUpdated(interestRate);
    }

    function setIssueFeeRate(uint256 _issueFeeRate) external onlyOwner {
        issueFeeRate = _issueFeeRate;
        emit IssueFeeRateUpdated(issueFeeRate);
    }

    function setIssueLimit(uint256 _issueLimit) external onlyOwner {
        issueLimit = _issueLimit;
        emit IssueLimitUpdated(issueLimit);
    }

    function setMinLoanSize(uint256 _minLoanSize) external onlyOwner {
        minLoanSize = _minLoanSize;
        emit MinLoanSizeUpdated(minLoanSize);
    }

    function setAccountLoanLimit(uint256 _loanLimit) external onlyOwner {
        uint256 HARD_CAP = 1000;
        require(_loanLimit < HARD_CAP, "Owner cannot set higher than HARD_CAP");
        accountLoanLimit = _loanLimit;
        emit AccountLoanLimitUpdated(accountLoanLimit);
    }

    function setLoanLiquidationOpen(bool _loanLiquidationOpen) external onlyOwner {
        require(now > liquidationDeadline, "Before liquidation deadline");
        loanLiquidationOpen = _loanLiquidationOpen;
        emit LoanLiquidationOpenUpdated(loanLiquidationOpen);
    }

    // ========== PUBLIC VIEWS ==========

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](5);
        addresses[0] = CONTRACT_SYSTEMSTATUS;
        addresses[1] = CONTRACT_PYNTHPETH;
        addresses[2] = CONTRACT_PYNTHPUSD;
        addresses[3] = CONTRACT_DEPOT;
        addresses[4] = CONTRACT_EXRATES;
    }

    function getContractInfo()
        external
        view
        returns (
            uint256 _collateralizationRatio,
            uint256 _issuanceRatio,
            uint256 _interestRate,
            uint256 _interestPerSecond,
            uint256 _issueFeeRate,
            uint256 _issueLimit,
            uint256 _minLoanSize,
            uint256 _totalIssuedPynths,
            uint256 _totalLoansCreated,
            uint256 _totalOpenLoanCount,
            uint256 _ethBalance,
            uint256 _liquidationDeadline,
            bool _loanLiquidationOpen
        )
    {
        _collateralizationRatio = collateralizationRatio;
        _issuanceRatio = issuanceRatio();
        _interestRate = interestRate;
        _interestPerSecond = interestPerSecond;
        _issueFeeRate = issueFeeRate;
        _issueLimit = issueLimit;
        _minLoanSize = minLoanSize;
        _totalIssuedPynths = totalIssuedPynths;
        _totalLoansCreated = totalLoansCreated;
        _totalOpenLoanCount = totalOpenLoanCount;
        _ethBalance = address(this).balance;
        _liquidationDeadline = liquidationDeadline;
        _loanLiquidationOpen = loanLiquidationOpen;
    }

    // returns value of 100 / collateralizationRatio.
    // e.g. 100/125 = 0.8
    // or in wei 100000000000000000000/125000000000000000000 = 800000000000000000
    function issuanceRatio() public view returns (uint256) {
        // this Rounds so you get slightly more rather than slightly less
        // 4999999999999999995000
        return ONE_HUNDRED.divideDecimalRound(collateralizationRatio);
    }

    function loanAmountFromCollateral(uint256 collateralAmount) public view returns (uint256) {
        return collateralAmount.multiplyDecimal(issuanceRatio());
    }

    function collateralAmountForLoan(uint256 loanAmount) external view returns (uint256) {
        return loanAmount.multiplyDecimal(collateralizationRatio.divideDecimalRound(ONE_HUNDRED));
    }

    function currentInterestOnLoan(address _account, uint256 _loanID) external view returns (uint256) {
        // Get the loan from storage
        PynthLoanStruct memory pynthLoan = _getLoanFromStorage(_account, _loanID);
        uint256 loanLifeSpan = _loanLifeSpan(pynthLoan);
        return accruedInterestOnLoan(pynthLoan.loanAmount, loanLifeSpan);
    }

    function accruedInterestOnLoan(uint256 _loanAmount, uint256 _seconds) public view returns (uint256 interestAmount) {
        // Simple interest calculated per second
        // Interest = Principal * rate * time
        interestAmount = _loanAmount.multiplyDecimalRound(interestPerSecond.mul(_seconds));
    }

    function calculateMintingFee(address _account, uint256 _loanID) external view returns (uint256) {
        // Get the loan from storage
        PynthLoanStruct memory pynthLoan = _getLoanFromStorage(_account, _loanID);
        return _calculateMintingFee(pynthLoan);
    }

    function openLoanIDsByAccount(address _account) external view returns (uint256[] memory) {
        PynthLoanStruct[] memory pynthLoans = accountsPynthLoans[_account];

        uint256[] memory _openLoanIDs = new uint256[](pynthLoans.length);
        uint256 _counter = 0;

        for (uint256 i = 0; i < pynthLoans.length; i++) {
            if (pynthLoans[i].timeClosed == 0) {
                _openLoanIDs[_counter] = pynthLoans[i].loanID;
                _counter++;
            }
        }
        // Create the fixed size array to return
        uint256[] memory _result = new uint256[](_counter);

        // Copy loanIDs from dynamic array to fixed array
        for (uint256 j = 0; j < _counter; j++) {
            _result[j] = _openLoanIDs[j];
        }
        // Return an array with list of open Loan IDs
        return _result;
    }

    function getLoan(address _account, uint256 _loanID)
        external
        view
        returns (
            address account,
            uint256 collateralAmount,
            uint256 loanAmount,
            uint256 timeCreated,
            uint256 loanID,
            uint256 timeClosed,
            uint256 interest,
            uint256 totalFees
        )
    {
        PynthLoanStruct memory pynthLoan = _getLoanFromStorage(_account, _loanID);
        account = pynthLoan.account;
        collateralAmount = pynthLoan.collateralAmount;
        loanAmount = pynthLoan.loanAmount;
        timeCreated = pynthLoan.timeCreated;
        loanID = pynthLoan.loanID;
        timeClosed = pynthLoan.timeClosed;
        interest = accruedInterestOnLoan(pynthLoan.loanAmount, _loanLifeSpan(pynthLoan));
        totalFees = interest.add(_calculateMintingFee(pynthLoan));
    }

    function loanLifeSpan(address _account, uint256 _loanID) external view returns (uint256 loanLifeSpanResult) {
        PynthLoanStruct memory pynthLoan = _getLoanFromStorage(_account, _loanID);
        loanLifeSpanResult = _loanLifeSpan(pynthLoan);
    }

    // ========== PUBLIC FUNCTIONS ==========

    function openLoan() external payable notPaused nonReentrant pETHRateNotInvalid returns (uint256 loanID) {
        systemStatus().requireIssuanceActive();

        // Require ETH sent to be greater than minLoanSize
        require(msg.value >= minLoanSize, "Not enough ETH to create this loan. Please see the minLoanSize");

        // Require loanLiquidationOpen to be false or we are in liquidation phase
        require(loanLiquidationOpen == false, "Loans are now being liquidated");

        // Each account is limted to creating 50 (accountLoanLimit) loans
        require(accountsPynthLoans[msg.sender].length < accountLoanLimit, "Each account is limted to 50 loans");

        // Calculate issuance amount
        uint256 loanAmount = loanAmountFromCollateral(msg.value);

        // Require pETH to mint does not exceed cap
        require(totalIssuedPynths.add(loanAmount) < issueLimit, "Loan Amount exceeds the supply cap.");

        // Get a Loan ID
        loanID = _incrementTotalLoansCounter();

        // Create Loan storage object
        PynthLoanStruct memory pynthLoan =
            PynthLoanStruct({
                account: msg.sender,
                collateralAmount: msg.value,
                loanAmount: loanAmount,
                timeCreated: now,
                loanID: loanID,
                timeClosed: 0
            });

        // Record loan in mapping to account in an array of the accounts open loans
        accountsPynthLoans[msg.sender].push(pynthLoan);

        // Increment totalIssuedPynths
        totalIssuedPynths = totalIssuedPynths.add(loanAmount);

        // Issue the pynth
        pynthpETH().issue(msg.sender, loanAmount);

        // Tell the Dapps a loan was created
        emit LoanCreated(msg.sender, loanID, loanAmount);
    }

    function closeLoan(uint256 loanID) external nonReentrant pETHRateNotInvalid {
        _closeLoan(msg.sender, loanID);
    }

    // Liquidation of an open loan available for anyone
    function liquidateUnclosedLoan(address _loanCreatorsAddress, uint256 _loanID) external nonReentrant pETHRateNotInvalid {
        require(loanLiquidationOpen, "Liquidation is not open");
        // Close the creators loan and send collateral to the closer.
        _closeLoan(_loanCreatorsAddress, _loanID);
        // Tell the Dapps this loan was liquidated
        emit LoanLiquidated(_loanCreatorsAddress, _loanID, msg.sender);
    }

    // ========== PRIVATE FUNCTIONS ==========

    function _closeLoan(address account, uint256 loanID) private {
        systemStatus().requireIssuanceActive();

        // Get the loan from storage
        PynthLoanStruct memory pynthLoan = _getLoanFromStorage(account, loanID);

        require(pynthLoan.loanID > 0, "Loan does not exist");
        require(pynthLoan.timeClosed == 0, "Loan already closed");
        require(
            IERC20(address(pynthpETH())).balanceOf(msg.sender) >= pynthLoan.loanAmount,
            "You do not have the required Pynth balance to close this loan."
        );

        // Record loan as closed
        _recordLoanClosure(pynthLoan);

        // Decrement totalIssuedPynths
        totalIssuedPynths = totalIssuedPynths.sub(pynthLoan.loanAmount);

        // Calculate and deduct interest(5%) and minting fee(50 bips) in ETH
        uint256 interestAmount = accruedInterestOnLoan(pynthLoan.loanAmount, _loanLifeSpan(pynthLoan));
        uint256 mintingFee = _calculateMintingFee(pynthLoan);
        uint256 totalFeeETH = interestAmount.add(mintingFee);

        // Burn all Pynths issued for the loan
        pynthpETH().burn(msg.sender, pynthLoan.loanAmount);

        // Fee Distribution. Purchase pUSD with ETH from Depot
        require(
            IERC20(address(pynthpUSD())).balanceOf(address(depot())) >= depot().pynthsReceivedForEther(totalFeeETH),
            "The pUSD Depot does not have enough pUSD to buy for fees"
        );
        depot().exchangeEtherForPynths.value(totalFeeETH)();

        // Transfer the pUSD to distribute to PERI holders.
        IERC20(address(pynthpUSD())).transfer(FEE_ADDRESS, IERC20(address(pynthpUSD())).balanceOf(address(this)));

        // Send remainder ETH to caller
        address(msg.sender).transfer(pynthLoan.collateralAmount.sub(totalFeeETH));

        // Tell the Dapps
        emit LoanClosed(account, loanID, totalFeeETH);
    }

    function _getLoanFromStorage(address account, uint256 loanID) private view returns (PynthLoanStruct memory) {
        PynthLoanStruct[] memory pynthLoans = accountsPynthLoans[account];
        for (uint256 i = 0; i < pynthLoans.length; i++) {
            if (pynthLoans[i].loanID == loanID) {
                return pynthLoans[i];
            }
        }
    }

    function _recordLoanClosure(PynthLoanStruct memory pynthLoan) private {
        // Get storage pointer to the accounts array of loans
        PynthLoanStruct[] storage pynthLoans = accountsPynthLoans[pynthLoan.account];
        for (uint256 i = 0; i < pynthLoans.length; i++) {
            if (pynthLoans[i].loanID == pynthLoan.loanID) {
                // Record the time the loan was closed
                pynthLoans[i].timeClosed = now;
            }
        }

        // Reduce Total Open Loans Count
        totalOpenLoanCount = totalOpenLoanCount.sub(1);
    }

    function _incrementTotalLoansCounter() private returns (uint256) {
        // Increase the total Open loan count
        totalOpenLoanCount = totalOpenLoanCount.add(1);
        // Increase the total Loans Created count
        totalLoansCreated = totalLoansCreated.add(1);
        // Return total count to be used as a unique ID.
        return totalLoansCreated;
    }

    function _calculateMintingFee(PynthLoanStruct memory pynthLoan) private view returns (uint256 mintingFee) {
        mintingFee = pynthLoan.loanAmount.multiplyDecimalRound(issueFeeRate);
    }

    function _loanLifeSpan(PynthLoanStruct memory pynthLoan) private view returns (uint256 loanLifeSpanResult) {
        // Get time loan is open for, and if closed from the timeClosed
        bool loanClosed = pynthLoan.timeClosed > 0;
        // Calculate loan life span in seconds as (Now - Loan creation time)
        loanLifeSpanResult = loanClosed ? pynthLoan.timeClosed.sub(pynthLoan.timeCreated) : now.sub(pynthLoan.timeCreated);
    }

    /* ========== INTERNAL VIEWS ========== */

    function systemStatus() internal view returns (ISystemStatus) {
        return ISystemStatus(requireAndGetAddress(CONTRACT_SYSTEMSTATUS));
    }

    function pynthpETH() internal view returns (IPynth) {
        return IPynth(requireAndGetAddress(CONTRACT_PYNTHPETH));
    }

    function pynthpUSD() internal view returns (IPynth) {
        return IPynth(requireAndGetAddress(CONTRACT_PYNTHPUSD));
    }

    function depot() internal view returns (IDepot) {
        return IDepot(requireAndGetAddress(CONTRACT_DEPOT));
    }

    function exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXRATES));
    }

    /* ========== MODIFIERS ========== */

    modifier pETHRateNotInvalid() {
        require(!exchangeRates().rateIsInvalid("pETH"), "Blocked as pETH rate is invalid");
        _;
    }

    // ========== EVENTS ==========

    event CollateralizationRatioUpdated(uint256 ratio);
    event InterestRateUpdated(uint256 interestRate);
    event IssueFeeRateUpdated(uint256 issueFeeRate);
    event IssueLimitUpdated(uint256 issueLimit);
    event MinLoanSizeUpdated(uint256 minLoanSize);
    event AccountLoanLimitUpdated(uint256 loanLimit);
    event LoanLiquidationOpenUpdated(bool loanLiquidationOpen);
    event LoanCreated(address indexed account, uint256 loanID, uint256 amount);
    event LoanClosed(address indexed account, uint256 loanID, uint256 feesPaid);
    event LoanLiquidated(address indexed account, uint256 loanID, address liquidator);
}
