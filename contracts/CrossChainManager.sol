pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";

import "./interfaces/ICrossChainManager.sol";
import "./interfaces/ICrossChainState.sol";
import "./interfaces/IDebtCache.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/IBridgeState.sol";

// Libraries
import "./SafeDecimalMath.sol";

contract CrossChainManager is Owned, MixinResolver, ICrossChainManager {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    address internal _crossChainState;
    address internal _debtManager;

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_DEBTCACHE = "DebtCache";
    bytes32 private constant CONTRACT_BRIDGESTATEPUSD = "BridgeStatepUSD";

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
        addresses[0] = CONTRACT_DEBTCACHE;
        addresses[1] = CONTRACT_ISSUER;
        addresses[2] = CONTRACT_BRIDGESTATEPUSD;
    }

    function debtCache() internal view returns (IDebtCache) {
        return IDebtCache(requireAndGetAddress(CONTRACT_DEBTCACHE));
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

    function getTotalNetworkAdaptedTotalSystemValue(address account, uint _totalSystemValue)
        external
        view
        returns (uint totalSystemValue)
    {
        (uint crossChainDebtEntryIndex, ) = state().getCrossNetworkUserData(account);
        uint userLastIssuanceTotalNetworkDebt = state().getTotalNetworkDebtEntryAtIndex(crossChainDebtEntryIndex);
        uint currentTotalNetworkDebt = state().lastTotalNetworkDebtLedgerEntry();

        if (userLastIssuanceTotalNetworkDebt >= currentTotalNetworkDebt) {
            totalSystemValue = _totalSystemValue.sub(
                userLastIssuanceTotalNetworkDebt.sub(currentTotalNetworkDebt).multiplyDecimal(
                    _currentNetworkDebtPercentage()
                )
            );
        } else {
            totalSystemValue = _totalSystemValue.add(
                currentTotalNetworkDebt.sub(userLastIssuanceTotalNetworkDebt).multiplyDecimal(
                    _currentNetworkDebtPercentage()
                )
            );
        }

        return totalSystemValue;
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
     * @return debt network ratio by total network debt at specific time
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
    function _networkDebtPercentage(uint totalNetworkDebt) internal view returns (uint) {
        (uint currentNetworkDebt, bool isInvalid) = debtCache().currentDebt();

        require(!isInvalid, "current total debt is not valid");

        uint outboundAmount = bridgeStatepUSD().getTotalOutboundAmount();
        uint inboundAmount = bridgeStatepUSD().getTotalInboundAmount();

        if (outboundAmount > 0) {
            currentNetworkDebt = currentNetworkDebt.add(outboundAmount);
        }

        if (inboundAmount > 0) {
            currentNetworkDebt = currentNetworkDebt.sub(inboundAmount);
        }

        return totalNetworkDebt == 0 ? SafeDecimalMath.unit() : currentNetworkDebt.divideDecimal(totalNetworkDebt);
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
    function addTotalNetworkDebt(uint totalNetworkDebt) external onlyDebtManager {
        state().appendTotalNetworkDebtLedger(totalNetworkDebt);
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
