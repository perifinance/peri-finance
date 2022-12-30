pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/IDebtCache.sol";

// Libraries
import "./SafeDecimalMath.sol";

// Internal references
import "./interfaces/IIssuer.sol";
import "./interfaces/IExchanger.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/ISystemStatus.sol";
import "./interfaces/IEtherCollateral.sol";
import "./interfaces/IEtherCollateralpUSD.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/ICollateralManager.sol";

// https://docs.peri.finance/contracts/source/contracts/debtcache
contract BaseDebtCache is Owned, MixinSystemSettings, IDebtCache {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    uint internal _cachedDebt;
    mapping(bytes32 => uint) internal _cachedPynthDebt;
    uint internal _cacheTimestamp;
    bool internal _cacheInvalid = true;

    /* ========== ENCODED NAMES ========== */

    bytes32 internal constant pUSD = "pUSD";
    bytes32 internal constant pETH = "pETH";

    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_EXCHANGER = "Exchanger";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";
    bytes32 private constant CONTRACT_SYSTEMSTATUS = "SystemStatus";
    bytes32 private constant CONTRACT_ETHERCOLLATERAL = "EtherCollateral";
    bytes32 private constant CONTRACT_ETHERCOLLATERAL_PUSD = "EtherCollateralpUSD";
    bytes32 private constant CONTRACT_COLLATERALMANAGER = "CollateralManager";

    constructor(address _owner, address _resolver) public Owned(_owner) MixinSystemSettings(_resolver) {}

    /* ========== VIEWS ========== */

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](7);
        newAddresses[0] = CONTRACT_ISSUER;
        newAddresses[1] = CONTRACT_EXCHANGER;
        newAddresses[2] = CONTRACT_EXRATES;
        newAddresses[3] = CONTRACT_SYSTEMSTATUS;
        newAddresses[4] = CONTRACT_ETHERCOLLATERAL;
        newAddresses[5] = CONTRACT_ETHERCOLLATERAL_PUSD;
        newAddresses[6] = CONTRACT_COLLATERALMANAGER;
        addresses = combineArrays(existingAddresses, newAddresses);
    }

    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function exchanger() internal view returns (IExchanger) {
        return IExchanger(requireAndGetAddress(CONTRACT_EXCHANGER));
    }

    function exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXRATES));
    }

    function systemStatus() internal view returns (ISystemStatus) {
        return ISystemStatus(requireAndGetAddress(CONTRACT_SYSTEMSTATUS));
    }

    function etherCollateral() internal view returns (IEtherCollateral) {
        return IEtherCollateral(requireAndGetAddress(CONTRACT_ETHERCOLLATERAL));
    }

    function etherCollateralpUSD() internal view returns (IEtherCollateralpUSD) {
        return IEtherCollateralpUSD(requireAndGetAddress(CONTRACT_ETHERCOLLATERAL_PUSD));
    }

    function collateralManager() internal view returns (ICollateralManager) {
        return ICollateralManager(requireAndGetAddress(CONTRACT_COLLATERALMANAGER));
    }

    function debtSnapshotStaleTime() external view returns (uint) {
        return getDebtSnapshotStaleTime();
    }

    function cachedDebt() external view returns (uint) {
        return _cachedDebt;
    }

    function cachedPynthDebt(bytes32 currencyKey) external view returns (uint) {
        return _cachedPynthDebt[currencyKey];
    }

    function cacheTimestamp() external view returns (uint) {
        return _cacheTimestamp;
    }

    function cacheInvalid() external view returns (bool) {
        return _cacheInvalid;
    }

    function _cacheStale(uint timestamp) internal view returns (bool) {
        // Note a 0 timestamp means that the cache is uninitialised.
        // We'll keep the check explicitly in case the stale time is
        // ever set to something higher than the current unix time (e.g. to turn off staleness).
        return getDebtSnapshotStaleTime() < block.timestamp - timestamp || timestamp == 0;
    }

    function cacheStale() external view returns (bool) {
        return _cacheStale(_cacheTimestamp);
    }

    function _issuedPynthValues(bytes32[] memory currencyKeys, uint[] memory rates) internal view returns (uint[] memory) {
        uint numValues = currencyKeys.length;
        uint[] memory values = new uint[](numValues);
        IPynth[] memory pynths = issuer().getPynths(currencyKeys);

        for (uint i = 0; i < numValues; i++) {
            bytes32 key = currencyKeys[i];
            address pynthAddress = address(pynths[i]);
            require(pynthAddress != address(0), "Pynth does not exist");
            uint supply = IERC20(pynthAddress).totalSupply();

            if (collateralManager().isPynthManaged(key)) {
                uint collateralIssued = collateralManager().long(key);

                // this is an edge case --
                // if a pynth other than pUSD is only issued by non PERI collateral
                // the long value will exceed the supply if there was a minting fee,
                // so we check explicitly and 0 it out to prevent
                // a safesub overflow.

                if (collateralIssued > supply) {
                    supply = 0;
                } else {
                    supply = supply.sub(collateralIssued);
                }
            }

            bool ispUSD = key == pUSD;
            if (ispUSD || key == pETH) {
                IEtherCollateral etherCollateralContract =
                    ispUSD ? IEtherCollateral(address(etherCollateralpUSD())) : etherCollateral();
                uint etherCollateralSupply = etherCollateralContract.totalIssuedPynths();
                supply = supply.sub(etherCollateralSupply);
            }

            values[i] = supply.multiplyDecimalRound(rates[i]);
        }
        return values;
    }

    function _currentPynthDebts(bytes32[] memory currencyKeys)
        internal
        view
        returns (uint[] memory periIssuedDebts, bool anyRateIsInvalid)
    {
        (uint[] memory rates, bool isInvalid) = exchangeRates().ratesAndInvalidForCurrencies(currencyKeys);
        return (_issuedPynthValues(currencyKeys, rates), isInvalid);
    }

    function currentPynthDebts(bytes32[] calldata currencyKeys)
        external
        view
        returns (uint[] memory debtValues, bool anyRateIsInvalid)
    {
        return _currentPynthDebts(currencyKeys);
    }

    function _cachedPynthDebts(bytes32[] memory currencyKeys) internal view returns (uint[] memory) {
        uint numKeys = currencyKeys.length;
        uint[] memory debts = new uint[](numKeys);
        for (uint i = 0; i < numKeys; i++) {
            debts[i] = _cachedPynthDebt[currencyKeys[i]];
        }
        return debts;
    }

    function cachedPynthDebts(bytes32[] calldata currencyKeys) external view returns (uint[] memory periIssuedDebts) {
        return _cachedPynthDebts(currencyKeys);
    }

    function _currentDebt() internal view returns (uint debt, bool anyRateIsInvalid) {
        (uint[] memory values, bool isInvalid) = _currentPynthDebts(issuer().availableCurrencyKeys());
        uint numValues = values.length;
        uint total;
        for (uint i; i < numValues; i++) {
            total = total.add(values[i]);
        }

        // subtract the USD value of all shorts.
        (uint pusdValue, bool shortInvalid) = collateralManager().totalShort();

        total = total.sub(pusdValue);

        isInvalid = isInvalid || shortInvalid;

        return (total, isInvalid);
    }

    function currentDebt() external view returns (uint debt, bool anyRateIsInvalid) {
        return _currentDebt();
    }

    function cacheInfo()
        external
        view
        returns (
            uint debt,
            uint timestamp,
            bool isInvalid,
            bool isStale
        )
    {
        uint time = _cacheTimestamp;
        return (_cachedDebt, time, _cacheInvalid, _cacheStale(time));
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    // Stub out all mutative functions as no-ops;
    // since they do nothing, there are no restrictions

    function updateCachedPynthDebts(bytes32[] calldata currencyKeys) external {}

    function updateCachedPynthDebtWithRate(bytes32 currencyKey, uint currencyRate) external {}

    function updateCachedPynthDebtsWithRates(bytes32[] calldata currencyKeys, uint[] calldata currencyRates) external {}

    function updateDebtCacheValidity(bool currentlyInvalid) external {}

    function purgeCachedPynthDebt(bytes32 currencyKey) external {}

    function takeDebtSnapshot() external {}

    /* ========== MODIFIERS ========== */

    function _requireSystemActiveIfNotOwner() internal view {
        if (msg.sender != owner) {
            systemStatus().requireSystemActive();
        }
    }

    modifier requireSystemActiveIfNotOwner() {
        _requireSystemActiveIfNotOwner();
        _;
    }

    function _onlyIssuerOrExchangerOrPynthpUSD() internal view {
        IPynth pynthpUSD = issuer().pynths(pUSD);
        require(
            msg.sender == address(issuer()) || msg.sender == address(exchanger()) || msg.sender == address(pynthpUSD),
            "Sender is not Issuer or Exchanger or pynthpUSD"
        );
    }

    modifier onlyIssuerOrExchangerOrPynthpUSD() {
        _onlyIssuerOrExchangerOrPynthpUSD();
        _;
    }

    function _onlyIssuerOrExchanger() internal view {
        require(msg.sender == address(issuer()) || msg.sender == address(exchanger()), "Sender is not Issuer or Exchanger");
    }

    modifier onlyIssuerOrExchanger() {
        _onlyIssuerOrExchanger();
        _;
    }
}
