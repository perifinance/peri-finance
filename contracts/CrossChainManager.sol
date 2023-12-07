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
import "./interfaces/ISupplySchedule.sol";

// Libraries
import "./SafeDecimalMath.sol";

interface ICrossChainInternalDebtCache {
    function debtSnapshotStaleTime() external view returns (uint);

    function cachedDebt() external view returns (uint);

    function currentDebt() external view returns (uint debt, bool anyRateIsInvalid);
}

contract CrossChainManager is Owned, MixinResolver, ICrossChainManager {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    bytes32 internal constant pUSD = "pUSD";

    address internal _crossChainState;
    address internal _debtManager;

    uint internal _syncTimestamp;
    bool internal _isStale;

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_EXCHANGER = "Exchanger";
    bytes32 private constant CONTRACT_BRIDGESTATEPUSD = "BridgeStatepUSD";
    bytes32 private constant CONTRACT_EXCHANGERATES = "ExchangeRates";
    bytes32 private constant CONTRACT_DEBTCACHE = "DebtCache";
    bytes32 private constant CONTRACT_SUPPLYSCHEDULE = "SupplySchedule";

    constructor(
        address _owner,
        address _resolver,
        address _crossChainStateAddress,
        address _debtManagerAddress
    ) public Owned(_owner) MixinResolver(_resolver) {
        _crossChainState = _crossChainStateAddress;
        _debtManager = _debtManagerAddress;
    }

    //*********************** View functions ***************************
    /**
     * @notice return addresses of required resolver instance
     * @return address of required resolver addresses
     */
    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](6);
        addresses[0] = CONTRACT_ISSUER;
        addresses[1] = CONTRACT_EXCHANGER;
        addresses[2] = CONTRACT_BRIDGESTATEPUSD;
        addresses[3] = CONTRACT_EXCHANGERATES;
        addresses[4] = CONTRACT_DEBTCACHE;
        addresses[5] = CONTRACT_SUPPLYSCHEDULE;
    }

    /**
     * @notice return issuer instance
     * @return issuer instance
     */
    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    /**
     * @notice return exchanger instance
     * @return exchanger instance
     */
    function exchanger() internal view returns (IExchanger) {
        return IExchanger(requireAndGetAddress(CONTRACT_EXCHANGER));
    }

    /**
     * @notice return cross chain state instance
     * @return cross chain state instance
     */
    function state() internal view returns (ICrossChainState) {
        return ICrossChainState(_crossChainState);
    }

    /**
     * @notice return bridge state instance
     * @return bridge state instance
     */
    function bridgeStatepUSD() internal view returns (IBridgeState) {
        return IBridgeState(requireAndGetAddress(CONTRACT_BRIDGESTATEPUSD));
    }

    /**
     * @notice return exchange rates instance
     * @return exchange rates instance
     */
    function exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXCHANGERATES));
    }

    /**
     * @notice return debt cache instance
     * @return debt cache instance
     */
    function debtCache() internal view returns (ICrossChainInternalDebtCache) {
        return ICrossChainInternalDebtCache(requireAndGetAddress(CONTRACT_DEBTCACHE));
    }

    function supplySchedule() internal view returns (ISupplySchedule) {
        return ISupplySchedule(requireAndGetAddress(CONTRACT_SUPPLYSCHEDULE));
    }

    function mintableSupply() external view returns (uint) {
        require(_syncStale(_syncTimestamp) == false, "Cross chain debt is stale");

        uint _currRate = _currentNetworkDebtPercentage();
        require(SafeDecimalMath.preciseUnit() >= _currRate, "Network rate invalid");

        uint supplyToMint = supplySchedule().mintableSupply();
        supplyToMint = supplyToMint
            .decimalToPreciseDecimal()
            .multiplyDecimalRoundPrecise(_currRate)
            .preciseDecimalToDecimal();

        require(supplyToMint > 0, "No mintable supply");

        return supplyToMint;
    }

    function isMintable() external view returns (bool) {
        return supplySchedule().isMintable();
    }

    function minterReward() external view returns (uint) {
        return supplySchedule().minterReward();
    }

    // Mutative functions
    function recordMintEvent(uint supplyMinted) external returns (bool) {
        return supplySchedule().recordMintEvent(supplyMinted);
    }

    /**
     * @notice return current chain id
     * @return current chain id
     */
    function getChainID() external view returns (uint) {
        return state().getChainID();
    }

    /**
     * @notice return cross chain state instance address
     * @return cross chain state instance address
     */
    function crossChainState() external view returns (address) {
        return _crossChainState;
    }

    /**
     * @notice return debt manager instance address
     * @return debt manager instance address
     */
    function debtManager() external view returns (address) {
        return _debtManager;
    }

    /**
     * @notice return cross chain synchronization timestamp
     * @return cross chain synchronization timestamp
     */
    function syncTimestamp() external view returns (uint) {
        return _syncTimestamp;
    }

    /**
     * @notice return cross chain synchronization stale flag
     * @return cross chain synchronization stale flag
     */
    function isStale() external view returns (bool) {
        return _isStale;
    }

    /**
     * @notice return current cross chain count
     * @return current cross chain count
     */
    function crossChainCount() external view returns (uint) {
        return state().crossChainCount();
    }

    /**
     * @notice return current sum of total network system debt
     * @dev current network's active debt by currency key
     * @param currencyKey currency key
     * @return totalSystemValue debt,
     * @return anyRateIsInvalid any rate is invalid
     */
    function getCurrentNetworkAdaptedIssuedDebtValue(bytes32 currencyKey)
        external
        view
        returns (uint totalSystemValue, bool anyRateIsInvalid)
    {
        totalSystemValue = _currentNetworkIssuedDebt();

        if (currencyKey == pUSD) {
            return (totalSystemValue, false);
        }

        (uint currencyRate, bool currencyRateInvalid) = exchangeRates().rateAndInvalid(currencyKey);

        return (totalSystemValue.divideDecimalRound(currencyRate), currencyRateInvalid);
    }

    /**
     * @notice Get current network's active debt by currency key
     * @dev needs to consider issued debt change by staking and burning between the cross chain synchronization
     * @return totalSystemValue debt,
     * @return anyRateIsInvalid any rate is invalid
     */
    function getCurrentNetworkAdaptedActiveDebtValue(bytes32 currencyKey)
        external
        view
        returns (uint totalSystemValue, bool anyRateIsInvalid)
    {
        (totalSystemValue, anyRateIsInvalid) = _currentNetworkActiveDebt();

        if (currencyKey == pUSD) {
            return (totalSystemValue, anyRateIsInvalid);
        }

        (uint currencyRate, bool currencyRateInvalid) = exchangeRates().rateAndInvalid(currencyKey);

        return (totalSystemValue.divideDecimalRound(currencyRate), anyRateIsInvalid || currencyRateInvalid);
    }

    /**
     * @notice Get current network's issued debt
     * @dev deprecated
     * @return outbound amount
     */
    function getCurrentNetworkIssuedDebt() external view returns (uint) {
        uint currentNetworkIssuedDebt = _currentNetworkIssuedDebt();
        return currentNetworkIssuedDebt;
    }

    /**
     * @notice Get current network's active debt
     * @dev needs to consider issued debt change by staking and burning between the cross chain synchronization
     * @return outbound amount
     */
    function getCurrentNetworkActiveDebt() external view returns (uint) {
        (uint currentNetworkActiveDebt, ) = _currentNetworkActiveDebt();
        return currentNetworkActiveDebt;
    }

    /**
     * @notice Get connected chain's total issued debt
     * @return issued debt
     */
    function getCrossNetworkIssuedDebtAll() external view returns (uint) {
        return state().getCrossNetworkIssuedDebtAll();
    }

    /**
     * @notice Get connected chain's total active debt
     * @dev may need more robust way of secure the crosschain debts
     * @return active debt
     */
    function getCrossNetworkActiveDebtAll() external view returns (uint) {
        return state().getCrossNetworkActiveDebtAll();
    }

    /**
     * @notice Get CURRENT debt percentage of network by total networks
     * @dev external function
     * @return current debt ratio of network by total network debt
     */
    function currentNetworkDebtPercentage() external view returns (uint) {
        return _currentNetworkDebtPercentage();
    }

    /**
     * @notice Get current network's in&outbound net amount
     * @dev used for cross chain debt synchronization
     * @return outbound amount
     */
    function getMovedAmount(uint _inboundOutbound, uint targetNetworkId) external view returns (uint) {
        return bridgeStatepUSD().getMovedAmount(_inboundOutbound, targetNetworkId);
    }

    /**
     * @notice Get current network's inbound amount compiled by other networks
     * @dev used for cross chain debt synchronization
     * @return inbound amount
     */
    function getOutboundSumToCurrentNetwork() external view returns (uint) {
        return state().getOutboundSumToCurrentNetwork();
    }

    /**
     * @notice Get current cross chain synchronization stale flag
     * @dev used for cross chain debt synchronization
     * @return inbound amount
     */
    function syncStale() external view returns (bool) {
        return _syncStale(_syncTimestamp);
    }

    // ********************* Internal View functions ***************************

    /**
     * @notice Get CURRENT debt percentage of network by total networks
     * @dev internal function
     * @return current debt ratio of network by total network debt
     */
    function _currentNetworkDebtPercentage() internal view returns (uint networkPercentage) {
        // uint currIssuedDebt = _currentNetworkIssuedDebt();
        uint totalIssuedDebt = state().getTotalNetworkIssuedDebt();

        networkPercentage = totalIssuedDebt == 0
            ? SafeDecimalMath.preciseUnit()
            : _currentNetworkIssuedDebt().decimalToPreciseDecimal().divideDecimalRoundPrecise(
                totalIssuedDebt.decimalToPreciseDecimal()
            );
    }

    /**
     * @notice Get CURRENT network's issued debt
     * @dev internal function
     * @return currentNetworkIssuedDebt current network's issued debt
     */
    function _currentNetworkIssuedDebt() internal view returns (uint currentNetworkIssuedDebt) {
        currentNetworkIssuedDebt = state().getCurrentNetworkIssuedDebt();

        /* if (currentNetworkIssuedDebt != 0) {
            // adjustedAmount should be positive otherwise something's wrong 
            int adjustedAmount = _getInOutNetAmount() + int(currentNetworkIssuedDebt);
            require(adjustedAmount >= 0, "Network Issued Debt is corrupted");
            currentNetworkIssuedDebt = uint(adjustedAmount);
        } */
    }

    /**
     * @notice Get CURRENT network's in&out included debt percentage of network by total networks
     * @dev possibly deprecated
     * @return currentNetworActivekDebt current network's active debt
     */
    function _currentNetworkActiveDebt() internal view returns (uint currentNetworActivekDebt, bool anyRateIsInvalid) {
        (currentNetworActivekDebt, anyRateIsInvalid) = issuer().totalIssuedPynths(pUSD, true);

        // get current network's active debt by applying In&Out amount
        (uint inboundAmount, uint outboundAmount) = _getInOutAmount();
        currentNetworActivekDebt = currentNetworActivekDebt.add(outboundAmount).sub(inboundAmount);

        // get current network's active debt after multiplying the debt percentage to the total active debt
        currentNetworActivekDebt = currentNetworActivekDebt
            .add(state().getCrossNetworkActiveDebtAll())
            .decimalToPreciseDecimal()
            .multiplyDecimalRoundPrecise(_currentNetworkDebtPercentage())
            .preciseDecimalToDecimal();
    }

    /**
     * @notice Get CURRENT network's in&out
     * @dev internal function
     * @return inboundAmount inbound amount
     * @return outboundAmount  outbound amount
     */
    function _getInOutAmount() internal view returns (uint inboundAmount, uint outboundAmount) {
        outboundAmount = bridgeStatepUSD().getTotalOutboundAmount();
        inboundAmount = bridgeStatepUSD().getTotalInboundAmount();

        // if the amount is less than the amount comiled by the other networks, which means bridge is not synchronized yet
        uint outboundFromOtherNetwork = state().getOutboundSumToCurrentNetwork();
        // so, we need to use the-others's sum of outbound targeted to current network
        inboundAmount = inboundAmount < outboundFromOtherNetwork ? outboundFromOtherNetwork : inboundAmount;
    }

    /**
     * @notice Get synced timestamp
     * @dev Note a 0 timestamp means that the sync is uninitialised.
     * @param timestamp cross chain synchronization timestamp
     */
    function _syncStale(uint timestamp) internal view returns (bool) {
        return debtCache().debtSnapshotStaleTime() < block.timestamp - timestamp || timestamp == 0 || _isStale;
    }

    //************************* Mutative functions ***************************
    /**
     * @notice set state instance address for cross chain state management
     * @param crossChainStateAddress address of cross chain state instance
     */
    function setCrossChainState(address crossChainStateAddress) external onlyOwner {
        _crossChainState = crossChainStateAddress;
    }

    /**
     * @notice set debt manager address for cross chain debt operation
     * @param debtManagerAddress address of cross chain instance
     */
    function setDebtManager(address debtManagerAddress) external onlyOwner {
        _debtManager = debtManagerAddress;
    }

    /**
     * @notice add multiple connected chain name ids and network ids for cross chain state management
     * @param _networkIds network ids
     */
    function addNetworkIds(uint[] calldata _networkIds) external onlyOwner {
        for (uint i = 0; i < _networkIds.length; i++) {
            state().addNetworkId(_networkIds[i]);
        }
    }

    /**
     * @notice add current network's issued debt
     * @dev keep track of current network's issued debt
     * @param _amount debt amount
     */
    function addCurrentNetworkIssuedDebt(uint _amount) external {
        state().addIssuedDebt(state().getChainID(), _amount);

        _setStaleByDebtChangeRate(_amount);

        emit IssuedDebtAdded(_amount, state().getCurrentNetworkIssuedDebt(), block.timestamp, _isStale);
    }

    /**
     * @notice subtract current network's issued debt
     * @dev keep track of current network's issued debt
     * @param _amount debt amount
     */
    function subtractCurrentNetworkIssuedDebt(uint _amount) external {
        state().subtractIssuedDebt(state().getChainID(), _amount);

        _setStaleByDebtChangeRate(_amount);

        emit IssuedDebtSubtracted(_amount, state().getCurrentNetworkIssuedDebt(), block.timestamp, _isStale);
    }

    /**
     * @notice set all connected cross-chain's issued debt
     * @dev issued debt is the debt that is issued by the connected chain
     * @param _chainIDs chain ids
     * @param _amounts debt array
     */
    function setCrossNetworkIssuedDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts) external onlyDebtManager {
        state().setCrossNetworkIssuedDebtAll(_chainIDs, _amounts);
        _syncTimestamp = block.timestamp;
        _isStale = false;

        for (uint i = 0; i < _chainIDs.length; i++) {
            emit CrossChainIssuedDebtSynced(_chainIDs[i], _amounts[i], block.timestamp);
        }
    }

    /**
     * @notice set all connected cross-chain's active debt
     * @dev active debt is the debt that is all issued pynths assets' floating amount calculated by the exchange rate
     * @param _chainIDs chain ids
     * @param _amounts debt array
     */
    function setCrossNetworkActiveDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts) external onlyDebtManager {
        state().setCrossNetworkActiveDebtAll(_chainIDs, _amounts);
        _syncTimestamp = block.timestamp;
        _isStale = false;

        for (uint i = 0; i < _chainIDs.length; i++) {
            emit CrossChainActiveDebtSynced(_chainIDs[i], _amounts[i], block.timestamp);
        }
    }

    /**
     * @notice set all connected cross-chain's issued debt and inbound amount
     * @dev called by scheduler
     * @param _chainIDs chain ids
     * @param _activeDebts debt array
     * @param _issuedDebts debt array
     * @param _inbound current network's inbound amount compiled by other networks
     */
    function setCrossNetworkDebtsAll(
        uint[] calldata _chainIDs,
        uint[] calldata _issuedDebts,
        uint[] calldata _activeDebts,
        uint _inbound
    ) external onlyDebtManager {
        state().setCrossNetworkDebtsAll(_chainIDs, _issuedDebts, _activeDebts, _inbound);
        _syncTimestamp = block.timestamp;
        _isStale = false;

        for (uint i = 0; i < _chainIDs.length; i++) {
            emit CrossChainSynced(_chainIDs[i], _issuedDebts[i], _issuedDebts[i], block.timestamp);
        }
    }

    /**
     * @notice set current network's issued debt
     * @dev calling the function should be effective only at deployment
     */
    function setInitialCurrentIssuedDebt() external onlyOwner {
        uint currIssuedDebt = _currentNetworkIssuedDebt();

        (uint debt, ) = issuer().totalIssuedPynths(pUSD, true);
        if (currIssuedDebt <= 0) state().setInitialCurrentIssuedDebt(debt);
    }

    /**
     * @notice set inbound to current network from other networks
     * @param _amount debt amount
     */
    function setOutboundSumToCurrentNetwork(uint _amount) external onlyDebtManager {
        state().setOutboundSumToCurrentNetwork(_amount);
    }

    // ************************* Internal Mutative functions ***************************

    /**
     * @notice set cross chain synchronization stale flag
     * @dev internal function
     * @param _amount changed debt amount
     */
    function _setStaleByDebtChangeRate(uint _amount) internal {
        if (
            state().getCurrentNetworkIssuedDebt() > 0 &&
            _amount.divideDecimalRound(state().getCurrentNetworkIssuedDebt()) > 1000000000000000
        ) {
            _isStale = true;
        }
    }

    //*********************** */ Modifiers *******************************
    /**
     * @notice check if the caller is debt manager
     * @dev modifier
     */
    modifier onlyDebtManager() {
        require(msg.sender == _debtManager, "Only the debt manager may perform this action");
        _;
    }

    /**
     * @notice check if the caller is issuer or exchanger
     * @dev modifier
     */
    modifier onlyIssuerOrExchanger() {
        _onlyIssuerOrExchanger(); // Use an internal function to save code size.
        _;
    }

    /**
     * @notice check if the caller is issuer or exchanger
     * @dev modifier internal function
     */
    function _onlyIssuerOrExchanger() internal view {
        bool isIssuer = msg.sender == address(issuer());
        bool isExchanger = msg.sender == address(exchanger());
        require(isIssuer || isExchanger, "CrossChainManager: Only the issuer or exchanger contract can perform this action");
    }

    //****************** deprecated *******************/
    //****************** deprecated *******************/
    // View functions

    // /**
    //  * @notice Get cross-chain ids
    //  * @return current debt ratio of network by total network debt
    //  */
    // function getCrossChainIds() external view returns (bytes32[] memory) {
    //     return state().getCrossChainIds();
    // }

    // /**
    //  * @notice Get connected chain's issued debt
    //  * @dev possibly deprecated
    //  * @param _chainID chain id
    //  * @return issued debt
    //  */
    // function getCrossNetworkIssuedDebt(bytes32 _chainID) external view returns (uint) {
    //     return state().getCrossNetworkIssuedDebt(_chainID);
    // }

    // /**
    //  * @notice Get connected chain's active debt
    //  * @dev
    //  * @param _chainID chain id
    //  * @return active debt
    //  */
    // function getCrossNetworkActiveDebt(bytes32 _chainID) external view returns (uint) {
    //     return state().getCrossNetworkActiveDebt(_chainID);
    // }

    // /**
    //  * @notice return current sum of total network system debt
    //  * @dev deprecated
    //  * @return totalNetworkDebt uint
    //  */
    // function currentTotalNetworkDebt() external view returns (uint) {
    //     return state().lastTotalNetworkDebtLedgerEntry();
    // }

    // /**
    //  * @notice return user's cross chain debt entry index
    //  * @dev possibly deprecated
    //  */
    // function userIssuanceDataForTotalNetwork(address account)
    //     external
    //     view
    //     returns (uint crossChainDebtEntryIndex, uint userStateDebtLedgerIndex)
    // {
    //     (crossChainDebtEntryIndex, userStateDebtLedgerIndex) = state().getCrossNetworkUserData(account);
    // }

    // Mutative functions

    // /**
    //  * @notice add connected chain's issued debt
    //  * @dev deprecated
    //  * @param _chainID chain id
    //  * @param _amount debt amount
    //  */
    // function addIssuedDebt(bytes32 _chainID, uint _amount) external {
    //     state().addIssuedDebt(_chainID, _amount);
    //     return;
    // }

    // /**
    //  * @notice subtract connected chain's issued debt
    //  * @dev deprecated
    //  * @param _chainID chain id
    //  * @param _amount debt amount
    //  */
    // function subtractIssuedDebt(bytes32 _chainID, uint _amount) external {
    //     state().subtractIssuedDebt(_chainID, _amount);
    //     return;
    // }

    // /**
    //  * @notice save current sum of total network system debt to the state
    //  * @dev deprecated
    //  * @param totalNetworkDebt uint
    //  */
    // function appendTotalNetworkDebt(uint totalNetworkDebt) external onlyDebtManager {
    //     state().appendTotalNetworkDebtLedger(totalNetworkDebt);
    // }

    /**
     * @notice add amount to current sum of total network system debt
     * @dev deprecated
     * @param amount  debt amount
     */
    function addTotalNetworkDebt(uint amount) external onlyIssuerOrExchanger {
        uint totalNetworkDebtLedger = amount;
    }

    /**
     * @notice subtract amount from current sum of total network system debt
     * @dev deprecated
     * @param amount debt amount
     */
    function subtractTotalNetworkDebt(uint amount) external onlyIssuerOrExchanger {
        uint totalNetworkDebtLedger = amount;
    }

    /**
     * @notice set user's cross chain debt entry index
     * @dev deprecated
     */
    function setCrossNetworkUserDebt(address account, uint userStateDebtLedgerIndex) external onlyIssuerOrExchanger {
        // state().setCrossNetworkUserData(account, userStateDebtLedgerIndex);
        uint totalNetworkDebtLedgerIndex = userStateDebtLedgerIndex;
    }

    /**
     * @notice clear user's cross chain debt entry index
     * @dev deprecated
     */
    function clearCrossNetworkUserDebt(address account) external onlyIssuerOrExchanger {
        address accountAddress = account;
    }

    //*********************** Events ***************************
    /**
     * @notice Emitted when current network issued debt has added
     * @param amount uint
     * @param latestNetworkDebt uint
     * @param timestamp uint
     * @param syncInvalid bool
     */
    event IssuedDebtAdded(uint amount, uint latestNetworkDebt, uint timestamp, bool syncInvalid);

    /**
     * @notice Emitted when current network issued debt has subtracted
     * @param amount uint
     * @param latestNetworkDebt uint
     * @param timestamp uint
     * @param syncInvalid bool
     */
    event IssuedDebtSubtracted(uint amount, uint latestNetworkDebt, uint timestamp, bool syncInvalid);

    /**
     * @notice Emitted when current network debt has synchronized
     * @param chainID uint
     * @param issuedDebt uint
     * @param activeDebt uint
     * @param timestamp uint
     */
    event CrossChainSynced(uint chainID, uint issuedDebt, uint activeDebt, uint timestamp);

    /**
     * @notice Emitted when current network issued debt has subtracted
     * @param chainID uint
     * @param issuedDebt uint
     * @param timestamp uint
     */
    event CrossChainIssuedDebtSynced(uint chainID, uint issuedDebt, uint timestamp);

    /**
     * @notice Emitted when current network active debt has subtracted
     * @param chainID uint
     * @param activeDebt uint
     * @param timestamp uint
     */
    event CrossChainActiveDebtSynced(uint chainID, uint activeDebt, uint timestamp);
}
