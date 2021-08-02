pragma solidity 0.5.16;

// Inheritance
import "./interfaces/IERC20.sol";
import "./ExternStateToken.sol";
import "./MixinResolver.sol";
import "./interfaces/IPeriFinance.sol";

// Libraries
import "./SafeDecimalMath.sol";

// Internal references
import "./interfaces/IPynth.sol";
import "./TokenState.sol";
import "./interfaces/IPeriFinanceState.sol";
import "./interfaces/ISystemStatus.sol";
import "./interfaces/IExchanger.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/IVirtualPynth.sol";

interface IBlacklistManager {
    function flagged(address _account) external view returns (bool);
}

contract BasePeriFinance is IERC20, ExternStateToken, MixinResolver, IPeriFinance {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    // ========== STATE VARIABLES ==========

    // Available Pynths which can be used with the system
    string public constant TOKEN_NAME = "Peri Finance Token";
    string public constant TOKEN_SYMBOL = "PERI";
    uint8 public constant DECIMALS = 18;
    bytes32 public constant pUSD = "pUSD";

    // ========== ADDRESS RESOLVER CONFIGURATION ==========
    bytes32 private constant CONTRACT_PERIFINANCESTATE = "PeriFinanceState";
    bytes32 private constant CONTRACT_SYSTEMSTATUS = "SystemStatus";
    bytes32 private constant CONTRACT_EXCHANGER = "Exchanger";
    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_REWARDSDISTRIBUTION = "RewardsDistribution";

    IBlacklistManager public blacklistManager;

    // ========== CONSTRUCTOR ==========

    constructor(
        address payable _proxy,
        TokenState _tokenState,
        address _owner,
        uint _totalSupply,
        address _resolver,
        address _blacklistManager
    )
        public
        ExternStateToken(_proxy, _tokenState, TOKEN_NAME, TOKEN_SYMBOL, _totalSupply, DECIMALS, _owner)
        MixinResolver(_resolver)
    {
        blacklistManager = IBlacklistManager(_blacklistManager);
    }

    // ========== VIEWS ==========

    // Note: use public visibility so that it can be invoked in a subclass
    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](5);
        addresses[0] = CONTRACT_PERIFINANCESTATE;
        addresses[1] = CONTRACT_SYSTEMSTATUS;
        addresses[2] = CONTRACT_EXCHANGER;
        addresses[3] = CONTRACT_ISSUER;
        addresses[4] = CONTRACT_REWARDSDISTRIBUTION;
    }

    function periFinanceState() internal view returns (IPeriFinanceState) {
        return IPeriFinanceState(requireAndGetAddress(CONTRACT_PERIFINANCESTATE));
    }

    function systemStatus() internal view returns (ISystemStatus) {
        return ISystemStatus(requireAndGetAddress(CONTRACT_SYSTEMSTATUS));
    }

    function exchanger() internal view returns (IExchanger) {
        return IExchanger(requireAndGetAddress(CONTRACT_EXCHANGER));
    }

    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function rewardsDistribution() internal view returns (IRewardsDistribution) {
        return IRewardsDistribution(requireAndGetAddress(CONTRACT_REWARDSDISTRIBUTION));
    }

    function getRequiredAddress(bytes32 _contractName) external view returns (address) {
        return requireAndGetAddress(_contractName);
    }

    function debtBalanceOf(address account, bytes32 currencyKey) external view returns (uint) {
        return issuer().debtBalanceOf(account, currencyKey);
    }

    function totalIssuedPynths(bytes32 currencyKey) external view returns (uint) {
        return issuer().totalIssuedPynths(currencyKey, false);
    }

    function totalIssuedPynthsExcludeEtherCollateral(bytes32 currencyKey) external view returns (uint) {
        return issuer().totalIssuedPynths(currencyKey, true);
    }

    function availableCurrencyKeys() external view returns (bytes32[] memory) {
        return issuer().availableCurrencyKeys();
    }

    function availablePynthCount() external view returns (uint) {
        return issuer().availablePynthCount();
    }

    function availablePynths(uint index) external view returns (IPynth) {
        return issuer().availablePynths(index);
    }

    function pynths(bytes32 currencyKey) external view returns (IPynth) {
        return issuer().pynths(currencyKey);
    }

    function pynthsByAddress(address pynthAddress) external view returns (bytes32) {
        return issuer().pynthsByAddress(pynthAddress);
    }

    function isWaitingPeriod(bytes32 currencyKey) external view returns (bool) {
        return exchanger().maxSecsLeftInWaitingPeriod(messageSender, currencyKey) > 0;
    }

    function anyPynthOrPERIRateIsInvalid() external view returns (bool anyRateInvalid) {
        return issuer().anyPynthOrPERIRateIsInvalid();
    }

    function maxIssuablePynths(address account) external view returns (uint maxIssuable) {
        return issuer().maxIssuablePynths(account);
    }

    function externalTokenQuota(
        address _account,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) external view returns (uint) {
        return issuer().externalTokenQuota(_account, _additionalpUSD, _additionalExToken, _isIssue);
    }

    function remainingIssuablePynths(address account)
        external
        view
        returns (
            uint maxIssuable,
            uint alreadyIssued,
            uint totalSystemDebt
        )
    {
        return issuer().remainingIssuablePynths(account);
    }

    function maxExternalTokenStakeAmount(address _account, bytes32 _currencyKey)
        external
        view
        returns (uint issueAmountToQuota, uint stakeAmountToQuota)
    {
        return issuer().maxExternalTokenStakeAmount(_account, _currencyKey);
    }

    function collateralisationRatio(address _issuer) external view returns (uint) {
        return issuer().collateralisationRatio(_issuer);
    }

    function collateral(address account) external view returns (uint) {
        return issuer().collateral(account);
    }

    function transferablePeriFinance(address account) external view returns (uint transferable) {
        (transferable, ) = issuer().transferablePeriFinanceAndAnyRateIsInvalid(account, tokenState.balanceOf(account));
    }

    function _canTransfer(address account, uint value) internal view returns (bool) {
        (uint initialDebtOwnership, ) = periFinanceState().issuanceData(account);

        if (initialDebtOwnership > 0) {
            (uint transferable, bool anyRateIsInvalid) =
                issuer().transferablePeriFinanceAndAnyRateIsInvalid(account, tokenState.balanceOf(account));
            require(value <= transferable, "Cannot transfer staked or escrowed PERI");
            require(!anyRateIsInvalid, "A pynth or PERI rate is invalid");
        }
        return true;
    }

    // ========== MUTATIVE FUNCTIONS ==========

    function setBlacklistManager(address _blacklistManager) external onlyOwner {
        require(_blacklistManager != address(0), "address cannot be empty");

        blacklistManager = IBlacklistManager(_blacklistManager);
    }

    function exchange(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey
    )
        external
        exchangeActive(sourceCurrencyKey, destinationCurrencyKey)
        optionalProxy
        blacklisted(messageSender)
        returns (uint amountReceived)
    {
        _notImplemented();
        return exchanger().exchange(messageSender, sourceCurrencyKey, sourceAmount, destinationCurrencyKey, messageSender);
    }

    function exchangeOnBehalf(
        address exchangeForAddress,
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey
    )
        external
        exchangeActive(sourceCurrencyKey, destinationCurrencyKey)
        optionalProxy
        blacklisted(messageSender)
        blacklisted(exchangeForAddress)
        returns (uint amountReceived)
    {
        _notImplemented();
        return
            exchanger().exchangeOnBehalf(
                exchangeForAddress,
                messageSender,
                sourceCurrencyKey,
                sourceAmount,
                destinationCurrencyKey
            );
    }

    function settle(bytes32 currencyKey)
        external
        optionalProxy
        blacklisted(messageSender)
        returns (
            uint reclaimed,
            uint refunded,
            uint numEntriesSettled
        )
    {
        _notImplemented();
        return exchanger().settle(messageSender, currencyKey);
    }

    function exchangeWithTracking(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address originator,
        bytes32 trackingCode
    )
        external
        exchangeActive(sourceCurrencyKey, destinationCurrencyKey)
        optionalProxy
        blacklisted(messageSender)
        returns (uint amountReceived)
    {
        _notImplemented();
        return
            exchanger().exchangeWithTracking(
                messageSender,
                sourceCurrencyKey,
                sourceAmount,
                destinationCurrencyKey,
                messageSender,
                originator,
                trackingCode
            );
    }

    function exchangeOnBehalfWithTracking(
        address exchangeForAddress,
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address originator,
        bytes32 trackingCode
    )
        external
        exchangeActive(sourceCurrencyKey, destinationCurrencyKey)
        optionalProxy
        blacklisted(messageSender)
        blacklisted(exchangeForAddress)
        returns (uint amountReceived)
    {
        _notImplemented();
        return
            exchanger().exchangeOnBehalfWithTracking(
                exchangeForAddress,
                messageSender,
                sourceCurrencyKey,
                sourceAmount,
                destinationCurrencyKey,
                originator,
                trackingCode
            );
    }

    function transfer(address to, uint value) external optionalProxy systemActive blacklisted(messageSender) returns (bool) {
        // Ensure they're not trying to exceed their locked amount -- only if they have debt.
        _canTransfer(messageSender, value);

        // Perform the transfer: if there is a problem an exception will be thrown in this call.
        _transferByProxy(messageSender, to, value);

        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint value
    ) external optionalProxy systemActive blacklisted(messageSender) blacklisted(from) returns (bool) {
        // Ensure they're not trying to exceed their locked amount -- only if they have debt.
        _canTransfer(from, value);

        // Perform the transfer: if there is a problem,
        // an exception will be thrown in this call.
        return _transferFromByProxy(messageSender, from, to, value);
    }

    function issuePynths(bytes32 _currencyKey, uint _issueAmount)
        external
        issuanceActive
        optionalProxy
        blacklisted(messageSender)
    {
        issuer().issuePynths(messageSender, _currencyKey, _issueAmount);
    }

    function issueMaxPynths() external issuanceActive optionalProxy blacklisted(messageSender) {
        issuer().issueMaxPynths(messageSender);
    }

    function issuePynthsToMaxQuota(bytes32 _currencyKey) external issuanceActive optionalProxy blacklisted(messageSender) {
        issuer().issuePynthsToMaxQuota(messageSender, _currencyKey);
    }

    function burnPynths(bytes32 _currencyKey, uint _burnAmount)
        external
        issuanceActive
        optionalProxy
        blacklisted(messageSender)
    {
        issuer().burnPynths(messageSender, _currencyKey, _burnAmount);
    }

    function fitToClaimable() external issuanceActive optionalProxy blacklisted(messageSender) {
        issuer().fitToClaimable(messageSender);
    }

    function exit() external issuanceActive optionalProxy blacklisted(messageSender) {
        issuer().exit(messageSender);
    }

    function exchangeWithVirtual(
        bytes32,
        uint,
        bytes32,
        bytes32
    ) external returns (uint, IVirtualPynth) {
        _notImplemented();
    }

    function liquidateDelinquentAccount(address, uint) external returns (bool) {
        _notImplemented();
    }

    function mintSecondary(address, uint) external {
        _notImplemented();
    }

    function mintSecondaryRewards(uint) external {
        _notImplemented();
    }

    function burnSecondary(address, uint) external {
        _notImplemented();
    }

    function _notImplemented() internal pure {
        revert("Cannot be run on this layer");
    }

    // ========== MODIFIERS ==========

    modifier systemActive() {
        _systemActive();
        _;
    }

    function _systemActive() private view {
        systemStatus().requireSystemActive();
    }

    modifier issuanceActive() {
        _issuanceActive();
        _;
    }

    function _issuanceActive() private view {
        systemStatus().requireIssuanceActive();
    }

    function _blacklisted(address _account) private view {
        require(address(blacklistManager) != address(0), "Required contract is not set yet");
        require(!blacklistManager.flagged(_account), "Account is on blacklist");
    }

    modifier blacklisted(address _account) {
        _blacklisted(_account);
        _;
    }

    modifier exchangeActive(bytes32 src, bytes32 dest) {
        _exchangeActive(src, dest);
        _;
    }

    function _exchangeActive(bytes32 src, bytes32 dest) private view {
        systemStatus().requireExchangeBetweenPynthsAllowed(src, dest);
    }

    modifier onlyExchanger() {
        _onlyExchanger();
        _;
    }

    function _onlyExchanger() private view {
        require(msg.sender == address(exchanger()), "Only Exchanger can invoke this");
    }

    // ========== EVENTS ==========
    event PynthExchange(
        address indexed account,
        bytes32 fromCurrencyKey,
        uint256 fromAmount,
        bytes32 toCurrencyKey,
        uint256 toAmount,
        address toAddress
    );
    bytes32 internal constant PYNTHEXCHANGE_SIG =
        keccak256("PynthExchange(address,bytes32,uint256,bytes32,uint256,address)");

    function emitPynthExchange(
        address account,
        bytes32 fromCurrencyKey,
        uint256 fromAmount,
        bytes32 toCurrencyKey,
        uint256 toAmount,
        address toAddress
    ) external onlyExchanger {
        proxy._emit(
            abi.encode(fromCurrencyKey, fromAmount, toCurrencyKey, toAmount, toAddress),
            2,
            PYNTHEXCHANGE_SIG,
            addressToBytes32(account),
            0,
            0
        );
    }

    event ExchangeTracking(bytes32 indexed trackingCode, bytes32 toCurrencyKey, uint256 toAmount);
    bytes32 internal constant EXCHANGE_TRACKING_SIG = keccak256("ExchangeTracking(bytes32,bytes32,uint256)");

    function emitExchangeTracking(
        bytes32 trackingCode,
        bytes32 toCurrencyKey,
        uint256 toAmount
    ) external onlyExchanger {
        proxy._emit(abi.encode(toCurrencyKey, toAmount), 2, EXCHANGE_TRACKING_SIG, trackingCode, 0, 0);
    }

    event ExchangeReclaim(address indexed account, bytes32 currencyKey, uint amount);
    bytes32 internal constant EXCHANGERECLAIM_SIG = keccak256("ExchangeReclaim(address,bytes32,uint256)");

    function emitExchangeReclaim(
        address account,
        bytes32 currencyKey,
        uint256 amount
    ) external onlyExchanger {
        proxy._emit(abi.encode(currencyKey, amount), 2, EXCHANGERECLAIM_SIG, addressToBytes32(account), 0, 0);
    }

    event ExchangeRebate(address indexed account, bytes32 currencyKey, uint amount);
    bytes32 internal constant EXCHANGEREBATE_SIG = keccak256("ExchangeRebate(address,bytes32,uint256)");

    function emitExchangeRebate(
        address account,
        bytes32 currencyKey,
        uint256 amount
    ) external onlyExchanger {
        proxy._emit(abi.encode(currencyKey, amount), 2, EXCHANGEREBATE_SIG, addressToBytes32(account), 0, 0);
    }
}
