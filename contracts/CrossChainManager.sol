pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";

import "./interfaces/ICrossChainManager.sol";
import "./interfaces/ICrossChainState.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/IBridgeState.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IExchanger.sol";

// Libraries
import "./SafeDecimalMath.sol";

interface ICrossChainInternalDebtCache {
    function cachedDebt() external view returns (uint);

    function currentDebt() external view returns (uint debt, bool anyRateIsInvalid);
}

contract CrossChainManager is Owned, MixinResolver, ICrossChainManager {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    bytes32 internal constant pUSD = "pUSD";

    address internal _crossChainState;
    address internal _debtManager;

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_EXCHANGER = "Exchanger";
    bytes32 private constant CONTRACT_BRIDGESTATEPUSD = "BridgeStatepUSD";
    bytes32 private constant CONTRACT_EXCHANGERATES = "ExchangeRates";
    bytes32 private constant CONTRACT_DEBTCACHE = "DebtCache";

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
        addresses = new bytes32[](5);
        addresses[0] = CONTRACT_ISSUER;
        addresses[1] = CONTRACT_EXCHANGER;
        addresses[2] = CONTRACT_BRIDGESTATEPUSD;
        addresses[3] = CONTRACT_EXCHANGERATES;
        addresses[4] = CONTRACT_DEBTCACHE;
    }

    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function exchanger() internal view returns (IExchanger) {
        return IExchanger(requireAndGetAddress(CONTRACT_EXCHANGER));
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

    function debtCache() internal view returns (ICrossChainInternalDebtCache) {
        return ICrossChainInternalDebtCache(requireAndGetAddress(CONTRACT_DEBTCACHE));
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
        (totalSystemValue, anyRateIsInvalid) = _getCurrentNetworkPreservedDebt();

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

        // uint outbound = 0;
        uint inbound = 0;
        bytes32[] memory chainIds = state().getCrossChainIds();
        for (uint8 i = 0; i < chainIds.length; i++) {
            // bytes32 chainId = chainIds[i];
            // uint networkId = state().getNetworkId(chainId);
            // outbound = outbound.add(bridgeStatepUSD().getMovedAmount(1, networkId));
            inbound = inbound.add(state().getCrossNetworkInbound(chainIds[i]));
        }

        if (outboundAmount > 0) {
            currentNetworkDebt = currentNetworkDebt.add(outboundAmount);
        }

        if (inboundAmount > 0) {
            currentNetworkDebt = currentNetworkDebt.sub(inboundAmount);
        }

        require(inbound >= inboundAmount, "inbound must larger than inboundAmount");
        currentNetworkDebt = currentNetworkDebt.sub(inbound.sub(inboundAmount)); //.sub(outbound);
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

    function addTotalNetworkDebt(uint amount) external onlyIssuerOrExchanger {
        state().addTotalNetworkDebtLedger(amount);
    }

    function subtractTotalNetworkDebt(uint amount) external onlyIssuerOrExchanger {
        state().subtractTotalNetworkDebtLedger(amount);
    }

    function setCrossNetworkUserDebt(address account, uint userStateDebtLedgerIndex) external onlyIssuerOrExchanger {
        state().setCrossNetworkUserData(account, userStateDebtLedgerIndex);
    }

    function clearCrossNetworkUserDebt(address account) external onlyIssuerOrExchanger {
        state().clearCrossNetworkUserData(account);
    }

    function setCrosschain(bytes32 _chainID) external onlyOwner {
        state().setCrosschain(_chainID);
    }

    function addCrosschain(bytes32 _chainID) external onlyOwner {
        state().addCrosschain(_chainID);
    }

    function addNetworkId(bytes32 _chainID, uint _networkId) external onlyOwner {
        state().addNetworkId(_chainID, _networkId);
    }

    function getNetworkId(bytes32 _chainID) external view returns (uint) {
        return state().getNetworkId(_chainID);
    }

    function setCrossNetworkIssuedDebt(bytes32 _chainID, uint _amount) external onlyDebtManager {
        state().setCrossNetworkIssuedDebt(_chainID, _amount);
    }

    function getCrossNetworkIssuedDebt(bytes32 _chainID) external view returns (uint) {
        return state().getCrossNetworkIssuedDebt(_chainID);
    }

    function setCrossNetworkActiveDebt(bytes32 _chainID, uint _amount) external onlyDebtManager {
        state().setCrossNetworkActiveDebt(_chainID, _amount);
    }

    function getCrossNetworkActiveDebt(bytes32 _chainID) external view returns (uint) {
        return state().getCrossNetworkActiveDebt(_chainID);
    }

    function setCrossNetworkIssuedDebtAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts) external onlyDebtManager {
        state().setCrossNetworkIssuedDebtAll(_chainIDs, _amounts);
    }

    function getCrossNetworkIssuedDebtAll() external view returns (uint) {
        return state().getCrossNetworkIssuedDebtAll();
    }

    function setCrossNetworkActiveDebtAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts) external onlyDebtManager {
        state().setCrossNetworkActiveDebtAll(_chainIDs, _amounts);
    }

    function getCrossNetworkActiveDebtAll() external view returns (uint) {
        return state().getCrossNetworkActiveDebtAll();
    }

    function setCrossNetworkInboundAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts) external onlyDebtManager {
        state().setCrossNetworkInboundAll(_chainIDs, _amounts);
    }

    function getCrossNetworkInboundAll() external view returns (uint) {
        return state().getCrossNetworkInboundAll();
    }

    function setCrossNetworkDebtsAll(
        bytes32[] calldata _chainIDs,
        uint[] calldata _issuedDebts,
        uint[] calldata _activeDebts,
        uint[] calldata _inbounds
    ) external onlyDebtManager {
        state().setCrossNetworkIssuedDebtAll(_chainIDs, _issuedDebts);
        state().setCrossNetworkActiveDebtAll(_chainIDs, _activeDebts);
        state().setCrossNetworkInboundAll(_chainIDs, _inbounds);
        // state().setCrossNetworkDebtsAll(_chainIDs, _issuedDebts, _activeDebts, _inbounds);
    }

    function getCurrentNetworkIssuedDebt() external view returns (uint) {
        return state().getCurrentNetworkIssuedDebt();
    }

    function getCurrentNetworkActiveDebt() external view returns (uint) {
        uint currIssuedDebt = state().getCurrentNetworkIssuedDebt();
        uint totalIssuedDebt = state().getTotalNetworkIssuedDebt();
        if (totalIssuedDebt == 0) {
            return 0;
        }

        (uint currActiveDebt, ) = _getCurrentNetworkPreservedDebt();

        uint totalActiveDebt = state().getCrossNetworkActiveDebtAll() + currActiveDebt;

        return totalActiveDebt.multiplyDecimal(currIssuedDebt).divideDecimalRound(totalIssuedDebt);
    }

    function getCurrentNetworkAdaptedActiveDebtValue(bytes32 currencyKey)
        external
        view
        returns (uint totalSystemValue, bool anyRateIsInvalid)
    {
        anyRateIsInvalid = false;
        totalSystemValue = this.getCurrentNetworkActiveDebt();

        if (currencyKey == pUSD) {
            return (totalSystemValue, anyRateIsInvalid);
        }

        (uint currencyRate, bool currencyRateInvalid) = exchangeRates().rateAndInvalid(currencyKey);

        return (totalSystemValue.divideDecimalRound(currencyRate), anyRateIsInvalid || currencyRateInvalid);
    }

    function addIssuedDebt(bytes32 _chainID, uint _amount) external {
        state().addIssuedDebt(_chainID, _amount);
    }

    function subtractIssuedDebt(bytes32 _chainID, uint _amount) external {
        state().subtractIssuedDebt(_chainID, _amount);
    }

    function addCurrentNetworkIssuedDebt(uint _amount) external {
        state().addIssuedDebt(state().getChainID(), _amount);
    }

    function subtractCurrentNetworkIssuedDebt(uint _amount) external {
        state().subtractIssuedDebt(state().getChainID(), _amount);
    }

    function setInitialCurrentIssuedDebt() external {
        uint currIssuedDebt = debtCache().cachedDebt();
        state().setInitialCurrentIssuedDebt(currIssuedDebt);
    }

    function getMovedAmount(uint _inboundOutbound, uint targetNetworkId) external view returns (uint) {
        return bridgeStatepUSD().getMovedAmount(_inboundOutbound, targetNetworkId);
    }

    function _onlyIssuerOrExchanger() internal view {
        bool isIssuer = msg.sender == address(issuer());
        bool isExchanger = msg.sender == address(exchanger());
        require(isIssuer || isExchanger, "CrossChainManager: Only the issuer or exchanger contract can perform this action");
    }

    // Modifiers
    modifier onlyDebtManager() {
        require(msg.sender == _debtManager, "Only the debt manager may perform this action");
        _;
    }

    modifier onlyIssuerOrExchanger() {
        _onlyIssuerOrExchanger(); // Use an internal function to save code size.
        _;
    }
}
