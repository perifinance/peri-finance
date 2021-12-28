pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";

import "./interfaces/ICrossChainManager.sol";
import "./interfaces/ICrossChainState.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/IBridgeState.sol";
import "./interfaces/IExchangeRates.sol";

// Libraries
import "./SafeDecimalMath.sol";

contract CrossChainManager is Owned, MixinResolver, ICrossChainManager {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    bytes32 internal constant pUSD = "pUSD";

    address internal _crossChainState;
    address internal _debtManager;

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_BRIDGESTATEPUSD = "BridgeStatepUSD";
    bytes32 private constant CONTRACT_EXCHANGERATES = "ExchangeRates";

    constructor(
        address _owner,
        address _resolver,
        address _crossChainStateAddress,
        address _debtManagerAddress
    ) public Owned(_owner) MixinResolver(_resolver) {
        _crossChainState = _crossChainStateAddress;
        _debtManager = _debtManagerAddress;
    }

    // View functions
    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](3);
        addresses[0] = CONTRACT_ISSUER;
        addresses[1] = CONTRACT_BRIDGESTATEPUSD;
        addresses[2] = CONTRACT_EXCHANGERATES;
    }

    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function state() internal view returns (ICrossChainState) {
        return ICrossChainState(_crossChainState);
    }

    function bridgeStatepUSD() internal view returns (IBridgeState) {
        return IBridgeState(requireAndGetAddress(CONTRACT_BRIDGESTATEPUSD));
    }

    function exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXCHANGERATES));
    }

    function crossChainState() external view returns (address) {
        return _crossChainState;
    }

    function debtManager() external view returns (address) {
        return _debtManager;
    }

    function userIssuanceDataForTotalNetwork(address account)
        external
        view
        returns (uint crossChainDebtEntryIndex, uint userStateDebtLedgerIndex)
    {
        (crossChainDebtEntryIndex, userStateDebtLedgerIndex) = state().getCrossNetworkUserData(account);
    }

    function getTotalNetworkAdaptedTotalSystemValue(bytes32 currencyKey)
        external
        view
        returns (uint totalSystemValue, bool anyRateIsInvalid)
    {
        uint networkPercentage = _currentNetworkDebtPercentage();
        (totalSystemValue, anyRateIsInvalid) = _getCurrentNetworkPreservedDebt();

        totalSystemValue = state().lastTotalNetworkDebtLedgerEntry() == 0
            ? totalSystemValue
            : state()
                .lastTotalNetworkDebtLedgerEntry()
                .decimalToPreciseDecimal()
                .multiplyDecimalRoundPrecise(networkPercentage)
                .preciseDecimalToDecimal();

        if (currencyKey == pUSD) {
            return (totalSystemValue, anyRateIsInvalid);
        }

        (uint currencyRate, bool currencyRateInvalid) = exchangeRates().rateAndInvalid(currencyKey);

        return (totalSystemValue.divideDecimalRound(currencyRate), anyRateIsInvalid || currencyRateInvalid);
    }

    /**
     * @notice return current sum of total network system debt
     * @return totalNetworkDebt uint
     */
    function currentTotalNetworkDebt() external view returns (uint) {
        return state().lastTotalNetworkDebtLedgerEntry();
    }

    function totalNetworkDebtAtIndex(uint index) external view returns (uint) {
        return state().getTotalNetworkDebtEntryAtIndex(index);
    }

    /**
     * @notice Get owned debt percentage of network by total networks
     * @dev external function
     * @param _index uint
     * @return debt network ratio by total network debt at specific time
     */
    function networkDebtPercentageAtIndex(uint _index) external view returns (uint) {
        return _networkDebtPercentageAtIndex(_index);
    }

    function totalNetworkDebtEntryLength() external view returns (uint) {
        return state().totalNetworkDebtLedgerLength();
    }

    /**
     * @notice Get CURRENT owned debt percentage of network by total networks
     * @dev external function
     * @return current debt ratio of network by total network debt
     */
    function currentNetworkDebtPercentage() external view returns (uint) {
        return _currentNetworkDebtPercentage();
    }

    /**
     * @notice Get owned debt percentage of network by total networks
     * @dev internal function
     * @param _index uint
     * @return debt network ratio by total network debt at specific time, and
     */
    function _networkDebtPercentageAtIndex(uint _index) internal view returns (uint) {
        uint totalNetworkDebt = state().getTotalNetworkDebtEntryAtIndex(_index);

        return _networkDebtPercentage(totalNetworkDebt);
    }

    /**
     * @notice Get CURRENT owned debt percentage of network by total networks
     * @return current debt ratio of network by total network debt
     */
    function _currentNetworkDebtPercentage() internal view returns (uint) {
        uint totalNetworkDebt = state().lastTotalNetworkDebtLedgerEntry();

        return _networkDebtPercentage(totalNetworkDebt);
    }

    /**
     * @notice calculate owned debt percentage of network by total networks
     * @param totalNetworkDebt uint
     * @return network debt ratio by total network debt
     */
    function _networkDebtPercentage(uint totalNetworkDebt) internal view returns (uint networkPercentage) {
        (uint totalIssued, ) = _getCurrentNetworkPreservedDebt();

        networkPercentage = totalNetworkDebt == 0
            ? SafeDecimalMath.preciseUnit()
            : totalIssued.decimalToPreciseDecimal().divideDecimalRoundPrecise(totalNetworkDebt.decimalToPreciseDecimal());
    }

    function _getCurrentNetworkPreservedDebt() internal view returns (uint currentNetworkDebt, bool anyRateIsInvalid) {
        (currentNetworkDebt, anyRateIsInvalid) = issuer().totalIssuedPynths(pUSD, true);

        uint outboundAmount = bridgeStatepUSD().getTotalOutboundAmount();
        uint inboundAmount = bridgeStatepUSD().getTotalInboundAmount();

        if (outboundAmount > 0) {
            currentNetworkDebt = currentNetworkDebt.add(outboundAmount);
        }

        if (inboundAmount > 0) {
            currentNetworkDebt = currentNetworkDebt.sub(inboundAmount);
        }
    }

    // Mutative functions
    function setCrossChainState(address crossChainStateAddress) external onlyOwner {
        _crossChainState = crossChainStateAddress;
    }

    function setDebtManager(address debtManagerAddress) external onlyOwner {
        _debtManager = debtManagerAddress;
    }

    /**
     * @notice save current sum of total network system debt to the state
     * @param totalNetworkDebt uint
     */
    function appendTotalNetworkDebt(uint totalNetworkDebt) external onlyDebtManager {
        state().appendTotalNetworkDebtLedger(totalNetworkDebt);
    }

    function addTotalNetworkDebt(uint amount) external onlyIssuer {
        state().addTotalNetworkDebtLedger(amount);
    }

    function subtractTotalNetworkDebt(uint amount) external onlyIssuer {
        state().subtractTotalNetworkDebtLedger(amount);
    }

    function setCrossNetworkUserDebt(address account, uint userStateDebtLedgerIndex) external onlyIssuer {
        state().setCrossNetworkUserData(account, userStateDebtLedgerIndex);
    }

    function clearCrossNetworkUserDebt(address account) external onlyIssuer {
        state().clearCrossNetworkUserData(account);
    }

    function _onlyIssuer() internal view {
        require(msg.sender == address(issuer()), "CrossChainManager: Only the issuer contract can perform this action");
    }

    // Modifiers
    modifier onlyDebtManager() {
        require(msg.sender == _debtManager, "Only the debt manager may perform this action");
        _;
    }

    modifier onlyIssuer() {
        _onlyIssuer(); // Use an internal function to save code size.
        _;
    }
}
