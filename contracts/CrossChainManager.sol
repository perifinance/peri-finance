pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";

import "./interfaces/ICrossChainManager.sol";
import "./interfaces/ICrossChainState.sol";
import "./interfaces/IDebtCache.sol";
import "./interfaces/IIssuer.sol";

// Libraries
import "./SafeDecimalMath.sol";

contract CrossChainManager is Owned, MixinResolver, ICrossChainManager {
    using SafeDecimalMath for uint;

    address internal _crossChainState;
    address internal _debtManager;

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
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
        addresses = new bytes32[](2);
        addresses[0] = CONTRACT_DEBTCACHE;
        addresses[1] = CONTRACT_ISSUER;
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

    function crossChainState() external view returns (address) {
        return _crossChainState;
    }

    function debtManager() external view returns (address) {
        return _debtManager;
    }

    /**
     * @notice return current sum of total network system debt
     * @return totalNetworkDebt uint
     */
    function currentTotalNetworkDebt() external view returns (uint) {
        return state().lastTotalNetworkDebtLedgerEntry();
    }

    /**
     * @notice Get owned debt percentage of network by total networks
     * @dev external function
     * @param _index uint
     * @return debt network ratio by total network debt at specific time
     */
    function ownedDebtPercentageAtIndex(uint _index) external view returns (uint) {
        return _ownedDebtPercentageAtIndex(_index);
    }

    /**
     * @notice Get CURRENT owned debt percentage of network by total networks
     * @dev external function
     * @return current debt ratio of network by total network debt
     */
    function currentOwnedDebtPercentage() external view returns (uint) {
        return _currentOwnedDebtPercentage();
    }

    /**
     * @notice Get owned debt percentage of network by total networks
     * @dev internal function
     * @param _index uint
     * @return debt network ratio by total network debt at specific time
     */
    function _ownedDebtPercentageAtIndex(uint _index) internal view returns (uint) {
        uint totalNetworkDebt = state().getTotalNetworkDebtEntryAtIndex(_index);

        return _debtPercentage(totalNetworkDebt);
    }

    /**
     * @notice Get CURRENT owned debt percentage of network by total networks
     * @return current debt ratio of network by total network debt
     */
    function _currentOwnedDebtPercentage() internal view returns (uint) {
        uint totalNetworkDebt = state().lastTotalNetworkDebtLedgerEntry();

        return _debtPercentage(totalNetworkDebt);
    }

    /**
     * @notice calculate owned debt percentage of network by total networks
     * @param totalNetworkDebt uint
     * @return network debt ratio by total network debt
     */
    function _debtPercentage(uint totalNetworkDebt) internal view returns (uint) {
        (uint currentNetworkDebt, bool isInvalid) = debtCache().currentDebt();

        require(!isInvalid, "current total debt is not valid");

        return currentNetworkDebt.divideDecimal(totalNetworkDebt);
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

    function setCrossNetworkUserDebt(address account, uint userDebt) external onlyIssuer {
        uint _totalNetworkDebtLedgerIndex = state().totalNetworkDebtLedgerLength();
        uint _currentTotalNetworkDebt = state().lastTotalNetworkDebtLedgerEntry();

        uint userDebtOwnershipOfTotalNetwork = userDebt.divideDecimalRoundPrecise(_currentTotalNetworkDebt);

        state().setCrossNetworkUserData(account, userDebtOwnershipOfTotalNetwork, _totalNetworkDebtLedgerIndex);
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
