pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./Pausable.sol";
import "./MixinResolver.sol";
import "./interfaces/ICollateralManager.sol";

// Libraries
import "./AddressSetLib.sol";
import "./Bytes32SetLib.sol";
import "./SafeDecimalMath.sol";

// Internal references
import "./CollateralManagerState.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IPynth.sol";

contract CollateralManager is ICollateralManager, Owned, Pausable, MixinResolver {
    /* ========== LIBRARIES ========== */
    using SafeMath for uint;
    using SafeDecimalMath for uint;
    using AddressSetLib for AddressSetLib.AddressSet;
    using Bytes32SetLib for Bytes32SetLib.Bytes32Set;

    /* ========== CONSTANTS ========== */

    bytes32 private constant pUSD = "pUSD";

    uint private constant SECONDS_IN_A_YEAR = 31556926 * 1e18;

    // Flexible storage names
    bytes32 public constant CONTRACT_NAME = "CollateralManager";
    bytes32 internal constant COLLATERAL_PYNTHS = "collateralPynth";

    /* ========== STATE VARIABLES ========== */

    // Stores debt balances and borrow rates.
    CollateralManagerState public state;

    // The set of all collateral contracts.
    AddressSetLib.AddressSet internal _collaterals;

    // The set of all pynths issuable by the various collateral contracts
    Bytes32SetLib.Bytes32Set internal _pynths;

    // Map from currency key to pynth contract name.
    mapping(bytes32 => bytes32) public pynthsByKey;

    // The set of all pynths that are shortable.
    Bytes32SetLib.Bytes32Set internal _shortablePynths;

    mapping(bytes32 => bytes32) public pynthToInversePynth;

    // The factor that will scale the utilisation ratio.
    uint public utilisationMultiplier = 1e18;

    // The maximum amount of debt in pUSD that can be issued by non peri collateral.
    uint public maxDebt;

    // The base interest rate applied to all borrows.
    uint public baseBorrowRate;

    // The base interest rate applied to all shorts.
    uint public baseShortRate;

    /* ---------- Address Resolver Configuration ---------- */

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";

    bytes32[24] private addressesToCache = [CONTRACT_ISSUER, CONTRACT_EXRATES];

    /* ========== CONSTRUCTOR ========== */
    constructor(
        CollateralManagerState _state,
        address _owner,
        address _resolver,
        uint _maxDebt,
        uint _baseBorrowRate,
        uint _baseShortRate
    ) public Owned(_owner) Pausable() MixinResolver(_resolver) {
        owner = msg.sender;
        state = _state;

        setMaxDebt(_maxDebt);
        setBaseBorrowRate(_baseBorrowRate);
        setBaseShortRate(_baseShortRate);

        owner = _owner;
    }

    /* ========== VIEWS ========== */

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory staticAddresses = new bytes32[](2);
        staticAddresses[0] = CONTRACT_ISSUER;
        staticAddresses[1] = CONTRACT_EXRATES;

        // we want to cache the name of the pynth and the name of its corresponding iPynth
        bytes32[] memory shortAddresses;
        uint length = _shortablePynths.elements.length;

        if (length > 0) {
            shortAddresses = new bytes32[](length * 2);

            for (uint i = 0; i < length; i++) {
                shortAddresses[i] = _shortablePynths.elements[i];
                shortAddresses[i + length] = pynthToInversePynth[_shortablePynths.elements[i]];
            }
        }

        bytes32[] memory pynthAddresses = combineArrays(shortAddresses, _pynths.elements);

        if (pynthAddresses.length > 0) {
            addresses = combineArrays(pynthAddresses, staticAddresses);
        } else {
            addresses = staticAddresses;
        }
    }

    // helper function to check whether pynth "by key" is a collateral issued by multi-collateral
    function isPynthManaged(bytes32 currencyKey) external view returns (bool) {
        return pynthsByKey[currencyKey] != bytes32(0);
    }

    /* ---------- Related Contracts ---------- */

    function _issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function _exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXRATES));
    }

    function _pynth(bytes32 pynthName) internal view returns (IPynth) {
        return IPynth(requireAndGetAddress(pynthName));
    }

    /* ---------- Manager Information ---------- */

    function hasCollateral(address collateral) public view returns (bool) {
        return _collaterals.contains(collateral);
    }

    function hasAllCollaterals(address[] memory collaterals) public view returns (bool) {
        for (uint i = 0; i < collaterals.length; i++) {
            if (!hasCollateral(collaterals[i])) {
                return false;
            }
        }
        return true;
    }

    /* ---------- State Information ---------- */

    function long(bytes32 pynth) external view returns (uint amount) {
        return state.long(pynth);
    }

    function short(bytes32 pynth) external view returns (uint amount) {
        return state.short(pynth);
    }

    function totalLong() public view returns (uint pusdValue, bool anyRateIsInvalid) {
        bytes32[] memory pynths = _pynths.elements;

        if (pynths.length > 0) {
            for (uint i = 0; i < pynths.length; i++) {
                bytes32 pynth = _pynth(pynths[i]).currencyKey();
                if (pynth == pUSD) {
                    pusdValue = pusdValue.add(state.long(pynth));
                } else {
                    (uint rate, bool invalid) = _exchangeRates().rateAndInvalid(pynth);
                    uint amount = state.long(pynth).multiplyDecimal(rate);
                    pusdValue = pusdValue.add(amount);
                    if (invalid) {
                        anyRateIsInvalid = true;
                    }
                }
            }
        }
    }

    function totalShort() public view returns (uint pusdValue, bool anyRateIsInvalid) {
        bytes32[] memory pynths = _shortablePynths.elements;

        if (pynths.length > 0) {
            for (uint i = 0; i < pynths.length; i++) {
                bytes32 pynth = _pynth(pynths[i]).currencyKey();
                (uint rate, bool invalid) = _exchangeRates().rateAndInvalid(pynth);
                uint amount = state.short(pynth).multiplyDecimal(rate);
                pusdValue = pusdValue.add(amount);
                if (invalid) {
                    anyRateIsInvalid = true;
                }
            }
        }
    }

    function getBorrowRate() external view returns (uint borrowRate, bool anyRateIsInvalid) {
        // get the peri backed debt.
        (uint periDebt, ) = _issuer().totalIssuedPynths(pUSD, true);

        // now get the non peri backed debt.
        (uint nonPeriDebt, bool ratesInvalid) = totalLong();

        // the total.
        uint totalDebt = periDebt.add(nonPeriDebt);

        // now work out the utilisation ratio, and divide through to get a per second value.
        uint utilisation = nonPeriDebt.divideDecimal(totalDebt).divideDecimal(SECONDS_IN_A_YEAR);

        // scale it by the utilisation multiplier.
        uint scaledUtilisation = utilisation.multiplyDecimal(utilisationMultiplier);

        // finally, add the base borrow rate.
        borrowRate = scaledUtilisation.add(baseBorrowRate);

        anyRateIsInvalid = ratesInvalid;
    }

    function getShortRate(bytes32 pynth) external view returns (uint shortRate, bool rateIsInvalid) {
        bytes32 pynthKey = _pynth(pynth).currencyKey();

        rateIsInvalid = _exchangeRates().rateIsInvalid(pynthKey);

        // get the spot supply of the pynth, its iPynth
        uint longSupply = IERC20(address(_pynth(pynth))).totalSupply();
        uint inverseSupply = IERC20(address(_pynth(pynthToInversePynth[pynth]))).totalSupply();
        // add the iPynth to supply properly reflect the market skew.
        uint shortSupply = state.short(pynthKey).add(inverseSupply);

        // in this case, the market is skewed long so its free to short.
        if (longSupply > shortSupply) {
            return (0, rateIsInvalid);
        }

        // otherwise workout the skew towards the short side.
        uint skew = shortSupply.sub(longSupply);

        // divide through by the size of the market
        uint proportionalSkew = skew.divideDecimal(longSupply.add(shortSupply)).divideDecimal(SECONDS_IN_A_YEAR);

        // finally, add the base short rate.
        shortRate = proportionalSkew.add(baseShortRate);
    }

    function getRatesAndTime(uint index)
        external
        view
        returns (
            uint entryRate,
            uint lastRate,
            uint lastUpdated,
            uint newIndex
        )
    {
        (entryRate, lastRate, lastUpdated, newIndex) = state.getRatesAndTime(index);
    }

    function getShortRatesAndTime(bytes32 currency, uint index)
        external
        view
        returns (
            uint entryRate,
            uint lastRate,
            uint lastUpdated,
            uint newIndex
        )
    {
        (entryRate, lastRate, lastUpdated, newIndex) = state.getShortRatesAndTime(currency, index);
    }

    function exceedsDebtLimit(uint amount, bytes32 currency) external view returns (bool canIssue, bool anyRateIsInvalid) {
        uint usdAmount = _exchangeRates().effectiveValue(currency, amount, pUSD);

        (uint longValue, bool longInvalid) = totalLong();
        (uint shortValue, bool shortInvalid) = totalShort();

        anyRateIsInvalid = longInvalid || shortInvalid;

        return (longValue.add(shortValue).add(usdAmount) <= maxDebt, anyRateIsInvalid);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /* ---------- SETTERS ---------- */

    function setUtilisationMultiplier(uint _utilisationMultiplier) public onlyOwner {
        require(_utilisationMultiplier > 0, "Must be greater than 0");
        utilisationMultiplier = _utilisationMultiplier;
    }

    function setMaxDebt(uint _maxDebt) public onlyOwner {
        require(_maxDebt > 0, "Must be greater than 0");
        maxDebt = _maxDebt;
        emit MaxDebtUpdated(maxDebt);
    }

    function setBaseBorrowRate(uint _baseBorrowRate) public onlyOwner {
        baseBorrowRate = _baseBorrowRate;
        emit BaseBorrowRateUpdated(baseBorrowRate);
    }

    function setBaseShortRate(uint _baseShortRate) public onlyOwner {
        baseShortRate = _baseShortRate;
        emit BaseShortRateUpdated(baseShortRate);
    }

    /* ---------- LOANS ---------- */

    function getNewLoanId() external onlyCollateral returns (uint id) {
        id = state.incrementTotalLoans();
    }

    /* ---------- MANAGER ---------- */

    function addCollaterals(address[] calldata collaterals) external onlyOwner {
        for (uint i = 0; i < collaterals.length; i++) {
            if (!_collaterals.contains(collaterals[i])) {
                _collaterals.add(collaterals[i]);
                emit CollateralAdded(collaterals[i]);
            }
        }
    }

    function removeCollaterals(address[] calldata collaterals) external onlyOwner {
        for (uint i = 0; i < collaterals.length; i++) {
            if (_collaterals.contains(collaterals[i])) {
                _collaterals.remove(collaterals[i]);
                emit CollateralRemoved(collaterals[i]);
            }
        }
    }

    function addPynths(bytes32[] calldata pynthNamesInResolver, bytes32[] calldata pynthKeys) external onlyOwner {
        for (uint i = 0; i < pynthNamesInResolver.length; i++) {
            if (!_pynths.contains(pynthNamesInResolver[i])) {
                bytes32 pynthName = pynthNamesInResolver[i];
                _pynths.add(pynthName);
                pynthsByKey[pynthKeys[i]] = pynthName;
                emit PynthAdded(pynthName);
            }
        }
    }

    function arePynthsAndCurrenciesSet(bytes32[] calldata requiredPynthNamesInResolver, bytes32[] calldata pynthKeys)
        external
        view
        returns (bool)
    {
        if (_pynths.elements.length != requiredPynthNamesInResolver.length) {
            return false;
        }

        for (uint i = 0; i < requiredPynthNamesInResolver.length; i++) {
            if (!_pynths.contains(requiredPynthNamesInResolver[i])) {
                return false;
            }
            if (pynthsByKey[pynthKeys[i]] != requiredPynthNamesInResolver[i]) {
                return false;
            }
        }

        return true;
    }

    function removePynths(bytes32[] calldata pynths, bytes32[] calldata pynthKeys) external onlyOwner {
        for (uint i = 0; i < pynths.length; i++) {
            if (_pynths.contains(pynths[i])) {
                // Remove it from the the address set lib.
                _pynths.remove(pynths[i]);
                delete pynthsByKey[pynthKeys[i]];

                emit PynthRemoved(pynths[i]);
            }
        }
    }

    // When we add a shortable pynth, we need to know the iPynth as well
    // This is so we can get the proper skew for the short rate.
    function addShortablePynths(bytes32[2][] calldata requiredPynthAndInverseNamesInResolver, bytes32[] calldata pynthKeys)
        external
        onlyOwner
    {
        require(requiredPynthAndInverseNamesInResolver.length == pynthKeys.length, "Input array length mismatch");

        for (uint i = 0; i < requiredPynthAndInverseNamesInResolver.length; i++) {
            // setting these explicitly for clarity
            // Each entry in the array is [Pynth, iPynth]
            bytes32 pynth = requiredPynthAndInverseNamesInResolver[i][0];
            bytes32 iPynth = requiredPynthAndInverseNamesInResolver[i][1];

            if (!_shortablePynths.contains(pynth)) {
                // Add it to the address set lib.
                _shortablePynths.add(pynth);

                // store the mapping to the iPynth so we can get its total supply for the borrow rate.
                pynthToInversePynth[pynth] = iPynth;

                emit ShortablePynthAdded(pynth);

                // now the associated pynth key to the CollateralManagerState
                state.addShortCurrency(pynthKeys[i]);
            }
        }

        rebuildCache();
    }

    function areShortablePynthsSet(bytes32[] calldata requiredPynthNamesInResolver, bytes32[] calldata pynthKeys)
        external
        view
        returns (bool)
    {
        require(requiredPynthNamesInResolver.length == pynthKeys.length, "Input array length mismatch");

        if (_shortablePynths.elements.length != requiredPynthNamesInResolver.length) {
            return false;
        }

        // first check contract state
        for (uint i = 0; i < requiredPynthNamesInResolver.length; i++) {
            bytes32 pynthName = requiredPynthNamesInResolver[i];
            if (!_shortablePynths.contains(pynthName) || pynthToInversePynth[pynthName] == bytes32(0)) {
                return false;
            }
        }

        // now check everything added to external state contract
        for (uint i = 0; i < pynthKeys.length; i++) {
            if (state.getShortRatesLength(pynthKeys[i]) == 0) {
                return false;
            }
        }

        return true;
    }

    function removeShortablePynths(bytes32[] calldata pynths) external onlyOwner {
        for (uint i = 0; i < pynths.length; i++) {
            if (_shortablePynths.contains(pynths[i])) {
                // Remove it from the the address set lib.
                _shortablePynths.remove(pynths[i]);

                bytes32 pynthKey = _pynth(pynths[i]).currencyKey();

                state.removeShortCurrency(pynthKey);

                // remove the inverse mapping.
                delete pynthToInversePynth[pynths[i]];

                emit ShortablePynthRemoved(pynths[i]);
            }
        }
    }

    /* ---------- STATE MUTATIONS ---------- */

    function updateBorrowRates(uint rate) external onlyCollateral {
        state.updateBorrowRates(rate);
    }

    function updateShortRates(bytes32 currency, uint rate) external onlyCollateral {
        state.updateShortRates(currency, rate);
    }

    function incrementLongs(bytes32 pynth, uint amount) external onlyCollateral {
        state.incrementLongs(pynth, amount);
    }

    function decrementLongs(bytes32 pynth, uint amount) external onlyCollateral {
        state.decrementLongs(pynth, amount);
    }

    function incrementShorts(bytes32 pynth, uint amount) external onlyCollateral {
        state.incrementShorts(pynth, amount);
    }

    function decrementShorts(bytes32 pynth, uint amount) external onlyCollateral {
        state.decrementShorts(pynth, amount);
    }

    /* ========== MODIFIERS ========== */

    modifier onlyCollateral {
        bool isMultiCollateral = hasCollateral(msg.sender);

        require(isMultiCollateral, "Only collateral contracts");
        _;
    }

    // ========== EVENTS ==========
    event MaxDebtUpdated(uint maxDebt);
    event LiquidationPenaltyUpdated(uint liquidationPenalty);
    event BaseBorrowRateUpdated(uint baseBorrowRate);
    event BaseShortRateUpdated(uint baseShortRate);

    event CollateralAdded(address collateral);
    event CollateralRemoved(address collateral);

    event PynthAdded(bytes32 pynth);
    event PynthRemoved(bytes32 pynth);

    event ShortablePynthAdded(bytes32 pynth);
    event ShortablePynthRemoved(bytes32 pynth);
}
