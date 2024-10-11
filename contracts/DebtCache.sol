pragma solidity 0.5.16;

// Inheritance
import "./BaseDebtCache.sol";

// https://docs.peri.finance/contracts/source/contracts/debtcache
contract DebtCache is BaseDebtCache {
    constructor(address _owner, address _resolver) public BaseDebtCache(_owner, _resolver) {}

    /* ========== MUTATIVE FUNCTIONS ========== */

    /**
     * @notice This function exists in case a pynth is ever somehow removed without its snapshot being updated.
     * @param currencyKey The pynth to remove the debt cache for
     */
    function purgeCachedPynthDebt(bytes32 currencyKey) external onlyOwner {
        require(issuer().pynths(currencyKey) == IPynth(0), "Pynth exists");
        delete _cachedPynthDebt[currencyKey];
    }

    /**
     * @notice take a snapshot of the debt. This is callable by anyone, but is owner
     */
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

    /**
     * @notice update cached pynths' debt when when pynth rates have changed beyond a threshold like 5%
     * @param currencyKeys the pynths to update the cached debt for
     */
    function updateCachedPynthDebts(bytes32[] calldata currencyKeys) external requireSystemActiveIfNotOwner {
        (uint[] memory rates, bool anyRateInvalid) = exchangeRates().ratesAndInvalidForCurrencies(currencyKeys);
        _updateCachedPynthDebtsWithRates(currencyKeys, rates, anyRateInvalid);
    }

    /**
     * @notice update cached pynths' debt when only a external sourced pynth rate has changed beyond a threshold like 5%
     * @param currencyKey the pynth to update the cached debt for
     */
    function updateCachedPynthDebtWithRate(bytes32 currencyKey, uint currencyRate)
        external
        onlyIssuerOrExchangerOrPynthpUSD
    {
        bytes32[] memory pynthKeyArray = new bytes32[](1);
        pynthKeyArray[0] = currencyKey;
        uint[] memory pynthRateArray = new uint[](1);
        pynthRateArray[0] = currencyRate;
        _updateCachedPynthDebtsWithRates(pynthKeyArray, pynthRateArray, false);
    }

    /**
     * @notice update cached pynths' debt when external sourced pynths have been changed beyond a threshold like 5%
     * @param currencyKeys the pynths to update the cached debt for and their currency rates
     */
    function updateCachedPynthDebtsWithRates(bytes32[] calldata currencyKeys, uint[] calldata currencyRates)
        external
        onlyIssuerOrExchangerOrPynthpUSD
    {
        _updateCachedPynthDebtsWithRates(currencyKeys, currencyRates, false);
    }

    /**
     * @notice invalidate the cached debt if needed
     */
    function updateDebtCacheValidity(bool currentlyInvalid) external onlyIssuerOrExchanger {
        _updateDebtCacheValidity(currentlyInvalid);
    }

    /* ========== INTERNAL FUNCTIONS ========== */

    function _updateDebtCacheValidity(bool currentlyInvalid) internal {
        if (_cacheInvalid != currentlyInvalid) {
            _cacheInvalid = currentlyInvalid;
            emit DebtCacheValidityChanged(currentlyInvalid);
        }
    }

    /**
     * @notice update cached pynths' debt with given keys and rates
     */
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
