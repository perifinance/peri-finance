pragma solidity 0.5.16;

// Inheritance
import "./BaseDebtCache.sol";

// https://docs.peri.finance/contracts/source/contracts/debtcache
contract DebtCache is BaseDebtCache {
    constructor(address _owner, address _resolver) public BaseDebtCache(_owner, _resolver) {}

    /* ========== MUTATIVE FUNCTIONS ========== */

    // This function exists in case a pynth is ever somehow removed without its snapshot being updated.
    function purgeCachedPynthDebt(bytes32 currencyKey) external onlyOwner {
        require(issuer().pynths(currencyKey) == IPynth(0), "Pynth exists");
        delete _cachedPynthDebt[currencyKey];
    }

    function takeDebtSnapshot() external requireSystemActiveIfNotOwner {
        bytes32[] memory currencyKeys = issuer().availableCurrencyKeys();
        (uint[] memory values, bool isInvalid) = _currentPynthDebts(currencyKeys);

        // Subtract the USD value of all shorts.
        (uint shortValue, ) = collateralManager().totalShort();

        uint numValues = values.length;
        uint periCollateralDebt;
        for (uint i; i < numValues; i++) {
            uint value = values[i];
            periCollateralDebt = periCollateralDebt.add(value);
            _cachedPynthDebt[currencyKeys[i]] = value;
        }
        _cachedDebt = periCollateralDebt.sub(shortValue);
        _cacheTimestamp = block.timestamp;
        emit DebtCacheUpdated(periCollateralDebt);
        emit DebtCacheSnapshotTaken(block.timestamp);

        // (in)validate the cache if necessary
        _updateDebtCacheValidity(isInvalid);
    }

    function updateCachedPynthDebts(bytes32[] calldata currencyKeys) external requireSystemActiveIfNotOwner {
        (uint[] memory rates, bool anyRateInvalid) = exchangeRates().ratesAndInvalidForCurrencies(currencyKeys);
        _updateCachedPynthDebtsWithRates(currencyKeys, rates, anyRateInvalid);
    }

    function updateCachedPynthDebtWithRate(bytes32 currencyKey, uint currencyRate) external onlyIssuer {
        bytes32[] memory pynthKeyArray = new bytes32[](1);
        pynthKeyArray[0] = currencyKey;
        uint[] memory pynthRateArray = new uint[](1);
        pynthRateArray[0] = currencyRate;
        _updateCachedPynthDebtsWithRates(pynthKeyArray, pynthRateArray, false);
    }

    function updateCachedPynthDebtsWithRates(bytes32[] calldata currencyKeys, uint[] calldata currencyRates)
        external
        onlyIssuerOrExchanger
    {
        _updateCachedPynthDebtsWithRates(currencyKeys, currencyRates, false);
    }

    function updateDebtCacheValidity(bool currentlyInvalid) external onlyIssuer {
        _updateDebtCacheValidity(currentlyInvalid);
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _updateDebtCacheValidity(bool currentlyInvalid) internal {
        if (_cacheInvalid != currentlyInvalid) {
            _cacheInvalid = currentlyInvalid;
            emit DebtCacheValidityChanged(currentlyInvalid);
        }
    }

    function _updateCachedPynthDebtsWithRates(
        bytes32[] memory currencyKeys,
        uint[] memory currentRates,
        bool anyRateIsInvalid
    ) internal {
        uint numKeys = currencyKeys.length;
        require(numKeys == currentRates.length, "Input array lengths differ");

        // Update the cached values for each pynth, saving the sums as we go.
        uint cachedSum;
        uint currentSum;
        uint[] memory currentValues = _issuedPynthValues(currencyKeys, currentRates);
        for (uint i = 0; i < numKeys; i++) {
            bytes32 key = currencyKeys[i];
            uint currentPynthDebt = currentValues[i];
            cachedSum = cachedSum.add(_cachedPynthDebt[key]);
            currentSum = currentSum.add(currentPynthDebt);
            _cachedPynthDebt[key] = currentPynthDebt;
        }

        // Compute the difference and apply it to the snapshot
        if (cachedSum != currentSum) {
            uint debt = _cachedDebt;
            // This requirement should never fail, as the total debt snapshot is the sum of the individual pynth
            // debt snapshots.
            require(cachedSum <= debt, "Cached pynth sum exceeds total debt");
            debt = debt.sub(cachedSum).add(currentSum);
            _cachedDebt = debt;
            emit DebtCacheUpdated(debt);
        }

        // A partial update can invalidate the debt cache, but a full snapshot must be performed in order
        // to re-validate it.
        if (anyRateIsInvalid) {
            _updateDebtCacheValidity(anyRateIsInvalid);
        }
    }

    /* ========== EVENTS ========== */

    event DebtCacheUpdated(uint cachedDebt);
    event DebtCacheSnapshotTaken(uint timestamp);
    event DebtCacheValidityChanged(bool indexed isInvalid);
}
