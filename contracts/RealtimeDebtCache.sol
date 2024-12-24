pragma solidity 0.5.16;

// Inheritance
import "./BaseDebtCache.sol";

// https://docs.peri.finance/contracts/source/contracts/realtimedebtcache
contract RealtimeDebtCache is BaseDebtCache {
    constructor(address _owner, address _resolver) public BaseDebtCache(_owner, _resolver) {}

    bytes32 internal constant EXCLUDED_DEBT_KEY = "EXCLUDED_DEBT";
    bytes32 internal constant FUTURES_DEBT_KEY = "FUTURES_DEBT";

// Report the current debt values from all cached debt functions, including public variables

    function debtSnapshotStaleTime() external view returns (uint) {
        return uint(-1);
    }

    function cachedDebt() external view returns (uint) {
        (uint currentDebt, ) = _currentDebt();
        return currentDebt;
    }

    function cachedPynthDebt(bytes32 currencyKey) external view returns (uint) {
        bytes32[] memory keyArray = new bytes32[](1);
        keyArray[0] = currencyKey;
        (uint[] memory debts, ) = _currentPynthDebts(keyArray);
        return debts[0];
    }

    function cacheTimestamp() external view returns (uint) {
        return block.timestamp;
    }

    function cacheStale() external view returns (bool) {
        return false;
    }

    function cacheInvalid() external view returns (bool) {
        (, bool invalid) = _currentDebt();
        return invalid;
    }

    function cachedPynthDebts(bytes32[] calldata currencyKeys) external view returns (uint[] memory debtValues) {
        (uint[] memory debts, ) = _currentPynthDebts(currencyKeys);
        return debts;
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
        (uint currentDebt, bool invalid) = _currentDebt();
        return (currentDebt, block.timestamp, invalid, false);
    }

    // Stub out all mutative functions as no-ops;
    // since they do nothing, their access restrictions have been dropped
    function takeDebtSnapshot() external {}

    function updateCachedPynthDebts(bytes32[] calldata currencyKeys) external {}

    function updateCachedPynthDebtWithRate(bytes32 currencyKey, uint currencyRate) external {}
    

    function updateCachedPynthDebtsWithRates(bytes32[] calldata currencyKeys, uint[] calldata currencyRates) external {}


    function updateDebtCacheValidity(bool currentlyInvalid) external {}
    /* ========== MUTATIVE FUNCTIONS ========== */

    // This function exists in case a pynth is ever somehow removed without its snapshot being updated.
    function purgeCachedPynthDebt(bytes32 currencyKey) external onlyOwner {
        // require(issuer().pynths(currencyKey) == IPynth(0), "Pynth exists");
        // delete _cachedPynthDebt[currencyKey];
    }

    // function updateCachedPynthDebts(bytes32[] calldata currencyKeys) external requireSystemActiveIfNotOwner {
    //     // (uint[] memory rates, bool anyRateInvalid) = exchangeRates().ratesAndInvalidForCurrencies(currencyKeys);
    //     // _updateCachedPynthDebtsWithRates(currencyKeys, rates, anyRateInvalid);
    // }

  

    // function updateCachedPynthDebtsWithRates(bytes32[] calldata currencyKeys, uint[] calldata currencyRates)
    //     external
    //     onlyIssuerOrExchanger
    // {
    //     _updateCachedPynthDebtsWithRates(currencyKeys, currencyRates, false);
    // }

    //function updateDebtCacheValidity(bool currentlyInvalid) external 
    //onlyIssuer
    //{
       // _updateDebtCacheValidity(currentlyInvalid);
    //}

    function recordExcludedDebtChange(bytes32 currencyKey, int256 delta) external 
        //onlyDebtIssuer 
    {
        // int256 newExcludedDebt = int256(_excludedIssuedDebt[currencyKey]) + delta;

        // require(newExcludedDebt >= 0, "Excluded debt cannot become negative");

        // _excludedIssuedDebt[currencyKey] = uint(newExcludedDebt);
    }

    function updateCachedpUSDDebt(int amount) external
     //onlyIssuer
    {
     //   uint delta = SafeDecimalMath.abs(amount);
        // if (amount > 0) {
        //     _cachedPynthDebt[pUSD] = _cachedPynthDebt[pUSD].add(delta);
        //     _cachedDebt = _cachedDebt.add(delta);
        // } else {
        //     _cachedPynthDebt[pUSD] = _cachedPynthDebt[pUSD].sub(delta);
        //     _cachedDebt = _cachedDebt.sub(delta);
        // }

        emit DebtCacheUpdated(_cachedDebt);
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    // function _updateDebtCacheValidity(bool currentlyInvalid) internal {
    //     if (_cacheInvalid != currentlyInvalid) {
    //         _cacheInvalid = currentlyInvalid;
    //         emit DebtCacheValidityChanged(currentlyInvalid);
    //     }
    // }

    // // Updated the global debt according to a rate/supply change in a subset of issued pynths.
    // function _updateCachedPynthDebtsWithRates(
    //     bytes32[] memory currencyKeys,
    //     uint[] memory currentRates,
    //     bool anyRateIsInvalid
    // ) internal {
    //     uint numKeys = currencyKeys.length;
    //     require(numKeys == currentRates.length, "Input array lengths differ");

    //     // Compute the cached and current debt sum for the subset of pynths provided.
    //     uint cachedSum;
    //     uint currentSum;
    //     uint[] memory currentValues = _issuedPynthValues(currencyKeys, currentRates);

    //     for (uint i = 0; i < numKeys; i++) {
    //         bytes32 key = currencyKeys[i];
    //         uint currentPynthDebt = currentValues[i];

    //         cachedSum = cachedSum.add(_cachedPynthDebt[key]);
    //         currentSum = currentSum.add(currentPynthDebt);

    //         _cachedPynthDebt[key] = currentPynthDebt;
    //     }

    //     // Apply the debt update.
    //     if (cachedSum != currentSum) {
    //         uint debt = _cachedDebt;
    //         // apply the delta between the cachedSum and currentSum
    //         // add currentSum before sub cachedSum to prevent overflow as cachedSum > debt for large amount of excluded debt
    //         debt = debt.add(currentSum).sub(cachedSum);
    //         _cachedDebt = debt;
    //         emit DebtCacheUpdated(debt);
    //     }

    //     // Invalidate the cache if necessary
    //     if (anyRateIsInvalid) {
    //         _updateDebtCacheValidity(anyRateIsInvalid);
    //     }
    // }

    /* ========== EVENTS ========== */

    event DebtCacheUpdated(uint cachedDebt);
    event DebtCacheSnapshotTaken(uint timestamp);
    event DebtCacheValidityChanged(bool indexed isInvalid);
}
