pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/ISystemSettings.sol";

// Libraries
import "./SafeDecimalMath.sol";

// https://docs.peri.finance/contracts/source/contracts/systemsettings
contract SystemSettings is Owned, MixinSystemSettings, ISystemSettings {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    // No more pynths may be issued than the value of PERI backing them.
    uint public constant MAX_ISSUANCE_RATIO = 1e18; // 1 issuance ratio  (collateral / debt)

    // The fee period must be between 1 day and 60 days.
    uint public constant MIN_FEE_PERIOD_DURATION = 1 days;
    uint public constant MAX_FEE_PERIOD_DURATION = 60 days;

    uint public constant MAX_TARGET_THRESHOLD = 50;

    uint public constant MAX_LIQUIDATION_RATIO = 1e18; // 100% issuance ratio

    uint public constant MAX_LIQUIDATION_PENALTY = 1e18 / 4; // Max 25% liquidation penalty / bonus

    uint public constant RATIO_FROM_TARGET_BUFFER = 2e18; // 200% - mininimum buffer between issuance ratio and liquidation ratio

    uint public constant MAX_LIQUIDATION_DELAY = 30 days;
    uint public constant MIN_LIQUIDATION_DELAY = 1 days;

    // Exchange fee may not exceed 10%.
    uint public constant MAX_EXCHANGE_FEE_RATE = 1e18 / 10;

    // Minimum Stake time may not exceed 1 weeks.
    uint public constant MAX_MINIMUM_STAKE_TIME = 1 weeks;

    uint public constant MAX_CROSS_DOMAIN_GAS_LIMIT = 8e6;
    uint public constant MIN_CROSS_DOMAIN_GAS_LIMIT = 3e6;

    uint public constant MAX_EXTERNAL_TOKEN_QUOTA = 8e17;

    uint public constant MAX_SYNC_STALE_THRESHOLD = 1e18 / 10; // 10% cross chain sync threshold

    constructor(address _owner, address _resolver) public Owned(_owner) MixinSystemSettings(_resolver) {}

    // ========== VIEWS ==========

    // SIP-37 Fee Reclamation
    // The number of seconds after an exchange is executed that must be waited
    // before settlement.
    function waitingPeriodSecs() external view returns (uint) {
        return getWaitingPeriodSecs();
    }

    // SIP-65 Decentralized Circuit Breaker
    // The factor amount expressed in decimal format
    // E.g. 3e18 = factor 3, meaning movement up to 3x and above or down to 1/3x and below
    function priceDeviationThresholdFactor() external view returns (uint) {
        return getPriceDeviationThresholdFactor();
    }

    // The raio of collateral
    // Expressed in 18 decimals. So 800% cratio is 100/800 = 0.125 (0.125e18)
    function issuanceRatio() external view returns (uint) {
        return getIssuanceRatio();
    }

    // How long a fee period lasts at a minimum. It is required for
    // anyone to roll over the periods, so they are not guaranteed
    // to roll over at exactly this duration, but the contract enforces
    // that they cannot roll over any quicker than this duration.
    function feePeriodDuration() external view returns (uint) {
        return getFeePeriodDuration();
    }

    // Users are unable to claim fees if their collateralisation ratio drifts out of target threshold
    function targetThreshold() external view returns (uint) {
        return getTargetThreshold();
    }

    // SIP-15 Liquidations
    // liquidation time delay after address flagged (seconds)
    function liquidationDelay() external view returns (uint) {
        return getLiquidationDelay();
    }

    // SIP-15 Liquidations
    // issuance ratio when account can be flagged for liquidation (with 18 decimals), e.g 0.5 issuance ratio
    // when flag means 1/0.5 = 200% cratio
    function liquidationRatio() external view returns (uint) {
        return getLiquidationRatio();
    }

    // SIP-15 Liquidations
    // penalty taken away from target of liquidation (with 18 decimals). E.g. 10% is 0.1e18
    function liquidationPenalty() external view returns (uint) {
        return getLiquidationPenalty();
    }

    // How long will the ExchangeRates contract assume the rate of any asset is correct
    function rateStalePeriod() external view returns (uint) {
        return getRateStalePeriod();
    }

    function exchangeFeeRate(bytes32 currencyKey) external view returns (uint) {
        return getExchangeFeeRate(currencyKey);
    }

    function minimumStakeTime() external view returns (uint) {
        return getMinimumStakeTime();
    }

    function debtSnapshotStaleTime() external view returns (uint) {
        return getDebtSnapshotStaleTime();
    }

    function aggregatorWarningFlags() external view returns (address) {
        return getAggregatorWarningFlags();
    }

    // SIP-63 Trading incentives
    // determines if Exchanger records fee entries in TradingRewards
    function tradingRewardsEnabled() external view returns (bool) {
        return getTradingRewardsEnabled();
    }

    function crossDomainMessageGasLimit(CrossDomainMessageGasLimits gasLimitType) external view returns (uint) {
        return getCrossDomainMessageGasLimit(gasLimitType);
    }

    function externalTokenQuota() external view returns (uint) {
        return getExternalTokenQuota();
    }

    function bridgeTransferGasCost() external view returns (uint) {
        return getBridgeTransferGasCost();
    }

    function bridgeClaimGasCost() external view returns (uint) {
        return getBridgeClaimGasCost();
    }

    function syncStaleThreshold() external view returns (uint) {
        return getSyncStaleThreshold();
    }

    function exTokenIssuanceRatio(bytes32 tokenKey) external view returns (uint) {
        return getExTokenIssuanceRatio(tokenKey);
    }

    function liquidationRatios(bytes32 tokenKey) external view returns (uint) {
        return getLiquidationRatios(tokenKey);
    }

    // ========== RESTRICTED ==========

    function setCrossDomainMessageGasLimit(CrossDomainMessageGasLimits _gasLimitType, uint _crossDomainMessageGasLimit)
        external
        onlyOwner
    {
        require(
            _crossDomainMessageGasLimit >= MIN_CROSS_DOMAIN_GAS_LIMIT &&
                _crossDomainMessageGasLimit <= MAX_CROSS_DOMAIN_GAS_LIMIT,
            "Out of range xDomain gasLimit"
        );
        flexibleStorage().setUIntValue(
            SETTING_CONTRACT_NAME,
            _getGasLimitSetting(_gasLimitType),
            _crossDomainMessageGasLimit
        );
        emit CrossDomainMessageGasLimitChanged(_gasLimitType, _crossDomainMessageGasLimit);
    }

    function setTradingRewardsEnabled(bool _tradingRewardsEnabled) external onlyOwner {
        flexibleStorage().setBoolValue(SETTING_CONTRACT_NAME, SETTING_TRADING_REWARDS_ENABLED, _tradingRewardsEnabled);
        emit TradingRewardsEnabled(_tradingRewardsEnabled);
    }

    function setWaitingPeriodSecs(uint _waitingPeriodSecs) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_WAITING_PERIOD_SECS, _waitingPeriodSecs);
        emit WaitingPeriodSecsUpdated(_waitingPeriodSecs);
    }

    function setPriceDeviationThresholdFactor(uint _priceDeviationThresholdFactor) external onlyOwner {
        flexibleStorage().setUIntValue(
            SETTING_CONTRACT_NAME,
            SETTING_PRICE_DEVIATION_THRESHOLD_FACTOR,
            _priceDeviationThresholdFactor
        );
        emit PriceDeviationThresholdUpdated(_priceDeviationThresholdFactor);
    }

    function setIssuanceRatio(uint _issuanceRatio) external onlyOwner {
        require(_issuanceRatio <= MAX_ISSUANCE_RATIO, "New issuance ratio cannot exceed MAX_ISSUANCE_RATIO");
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_ISSUANCE_RATIO, _issuanceRatio);
        emit IssuanceRatioUpdated(_issuanceRatio);
    }

    function setFeePeriodDuration(uint _feePeriodDuration) external onlyOwner {
        require(_feePeriodDuration >= MIN_FEE_PERIOD_DURATION, "value < MIN_FEE_PERIOD_DURATION");
        require(_feePeriodDuration <= MAX_FEE_PERIOD_DURATION, "value > MAX_FEE_PERIOD_DURATION");

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_FEE_PERIOD_DURATION, _feePeriodDuration);

        emit FeePeriodDurationUpdated(_feePeriodDuration);
    }

    function setTargetThreshold(uint _percent) external onlyOwner {
        require(_percent <= MAX_TARGET_THRESHOLD, "Threshold too high");

        uint _targetThreshold = _percent.mul(SafeDecimalMath.unit()).div(100);

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_TARGET_THRESHOLD, _targetThreshold);

        emit TargetThresholdUpdated(_targetThreshold);
    }

    function setLiquidationDelay(uint time) external onlyOwner {
        require(time <= MAX_LIQUIDATION_DELAY, "Must be less than 30 days");
        require(time >= MIN_LIQUIDATION_DELAY, "Must be greater than 1 day");

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_LIQUIDATION_DELAY, time);

        emit LiquidationDelayUpdated(time);
    }

    // The collateral / issuance ratio ( debt / collateral ) is higher when there is less collateral backing their debt
    // Upper bound liquidationRatio is 1 + penalty (100% + 10% = 110%) to allow collateral value to cover debt and liquidation penalty
    function setLiquidationRatio(uint _liquidationRatio) external onlyOwner {
        require(
            _liquidationRatio <= MAX_LIQUIDATION_RATIO.divideDecimal(SafeDecimalMath.unit().add(getLiquidationPenalty())),
            "liquidationRatio > MAX_LIQUIDATION_RATIO / (1 + penalty)"
        );

        // MIN_LIQUIDATION_RATIO is a product of target issuance ratio * RATIO_FROM_TARGET_BUFFER
        // Ensures that liquidation ratio is set so that there is a buffer between the issuance ratio and liquidation ratio.
        uint MIN_LIQUIDATION_RATIO = getIssuanceRatio().multiplyDecimal(RATIO_FROM_TARGET_BUFFER);
        require(_liquidationRatio >= MIN_LIQUIDATION_RATIO, "liquidationRatio < MIN_LIQUIDATION_RATIO");

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_LIQUIDATION_RATIO, _liquidationRatio);

        emit LiquidationRatioUpdated(_liquidationRatio);
    }

    function setLiquidationPenalty(uint penalty) external onlyOwner {
        require(penalty <= MAX_LIQUIDATION_PENALTY, "penalty > MAX_LIQUIDATION_PENALTY");

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_LIQUIDATION_PENALTY, penalty);

        emit LiquidationPenaltyUpdated(penalty);
    }

    function setRateStalePeriod(uint period) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_RATE_STALE_PERIOD, period);

        emit RateStalePeriodUpdated(period);
    }

    function setExchangeFeeRateForPynths(bytes32[] calldata pynthKeys, uint256[] calldata exchangeFeeRates)
        external
        onlyOwner
    {
        require(pynthKeys.length == exchangeFeeRates.length, "Array lengths dont match");
        for (uint i = 0; i < pynthKeys.length; i++) {
            require(exchangeFeeRates[i] <= MAX_EXCHANGE_FEE_RATE, "MAX_EXCHANGE_FEE_RATE exceeded");
            flexibleStorage().setUIntValue(
                SETTING_CONTRACT_NAME,
                keccak256(abi.encodePacked(SETTING_EXCHANGE_FEE_RATE, pynthKeys[i])),
                exchangeFeeRates[i]
            );
            emit ExchangeFeeUpdated(pynthKeys[i], exchangeFeeRates[i]);
        }
    }

    function setMinimumStakeTime(uint _seconds) external onlyOwner {
        require(_seconds <= MAX_MINIMUM_STAKE_TIME, "stake time exceed maximum 1 week");
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_MINIMUM_STAKE_TIME, _seconds);
        emit MinimumStakeTimeUpdated(_seconds);
    }

    function setDebtSnapshotStaleTime(uint _seconds) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_DEBT_SNAPSHOT_STALE_TIME, _seconds);
        emit DebtSnapshotStaleTimeUpdated(_seconds);
    }

    function setAggregatorWarningFlags(address _flags) external onlyOwner {
        require(_flags != address(0), "Valid address must be given");
        flexibleStorage().setAddressValue(SETTING_CONTRACT_NAME, SETTING_AGGREGATOR_WARNING_FLAGS, _flags);
        emit AggregatorWarningFlagsUpdated(_flags);
    }

    function setExternalTokenQuota(uint _newQuota) external onlyOwner {
        require(_newQuota <= MAX_EXTERNAL_TOKEN_QUOTA, "new quota exceeds maximum 100 percentage");

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_EXTERNAL_TOKEN_QUOTA, _newQuota);

        emit ExternalTokenQuotaUpdated(_newQuota);
    }

    function setBridgeTransferGasCost(uint _gasCost) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_BRIDGE_TRANSFER_GAS_COST, _gasCost);
    }

    function setBridgeClaimGasCost(uint _gasCost) external onlyOwner {
        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_BRIDGE_CLAIM_GAS_COST, _gasCost);
    }

    function setSyncStaleThreshold(uint _percent) external onlyOwner {
        require(_percent <= MAX_SYNC_STALE_THRESHOLD, "new threshold exceeds maximum 100 percentage");

        flexibleStorage().setUIntValue(SETTING_CONTRACT_NAME, SETTING_SYNC_STALE_THRESHOLD, _percent);

        emit SyncStaleThresholdUpdated(_percent);
    }

    function setExTokenIssuanceRatio(bytes32[] calldata tokenKeys, uint256[] calldata exTokenIssuanceRatios)
        external
        onlyOwner
    {
        require(tokenKeys.length == exTokenIssuanceRatios.length, "Array lengths dont match");
        for (uint i = 0; i < tokenKeys.length; i++) {
            require(exTokenIssuanceRatios[i] <= MAX_ISSUANCE_RATIO, "MAX_ISSUANCE_RATIO exceeded");
            flexibleStorage().setUIntValue(
                SETTING_CONTRACT_NAME,
                keccak256(abi.encodePacked(SETTING_EXTOKEN_ISSUANCE_RATIO, tokenKeys[i])),
                exTokenIssuanceRatios[i]
            );
            emit ExchangeFeeUpdated(tokenKeys[i], exTokenIssuanceRatios[i]);
        }
    }

    function setLiquidationRatios(bytes32[] calldata _types, uint256[] calldata _liquidationRatios) external onlyOwner {
        require(_types.length == _liquidationRatios.length, "Array lengths dont match");
        for (uint i = 0; i < _types.length; i++) {
            require(
                _liquidationRatios[i] <=
                    MAX_LIQUIDATION_RATIO.divideDecimal(SafeDecimalMath.unit().add(getLiquidationPenalty())),
                "liquidationRatio > MAX_LIQUIDATION_RATIO / (1 + penalty)"
            );

            // MIN_LIQUIDATION_RATIO is a product of target issuance ratio * RATIO_FROM_TARGET_BUFFER
            // Ensures that liquidation ratio is set so that there is a buffer between the issuance ratio and liquidation ratio.
            uint MIN_LIQUIDATION_RATIO = getIssuanceRatio().multiplyDecimal(RATIO_FROM_TARGET_BUFFER);
            require(_liquidationRatios[i] >= MIN_LIQUIDATION_RATIO, "liquidationRatio < MIN_LIQUIDATION_RATIO");

            flexibleStorage().setUIntValue(
                SETTING_CONTRACT_NAME,
                keccak256(abi.encodePacked(SETTING_LIQUIDATION_RATIOS, _types[i])),
                _liquidationRatios[i]
            );
            emit LiquidationRatiosUpdated(_types[i], _liquidationRatios[i]);
        }
    }

    // ========== EVENTS ==========
    event CrossDomainMessageGasLimitChanged(CrossDomainMessageGasLimits gasLimitType, uint newLimit);
    event TradingRewardsEnabled(bool enabled);
    event WaitingPeriodSecsUpdated(uint waitingPeriodSecs);
    event PriceDeviationThresholdUpdated(uint threshold);
    event IssuanceRatioUpdated(uint newRatio);
    event FeePeriodDurationUpdated(uint newFeePeriodDuration);
    event TargetThresholdUpdated(uint newTargetThreshold);
    event LiquidationDelayUpdated(uint newDelay);
    event LiquidationRatioUpdated(uint newRatio);
    event LiquidationPenaltyUpdated(uint newPenalty);
    event RateStalePeriodUpdated(uint rateStalePeriod);
    event ExchangeFeeUpdated(bytes32 pynthKey, uint newExchangeFeeRate);
    event MinimumStakeTimeUpdated(uint minimumStakeTime);
    event DebtSnapshotStaleTimeUpdated(uint debtSnapshotStaleTime);
    event AggregatorWarningFlagsUpdated(address flags);
    event ExternalTokenQuotaUpdated(uint quota);
    event SyncStaleThresholdUpdated(uint newRatio);
    event ExTokenIssuanceRatioUpdated(bytes32 pynthKey, uint exTokenIssuanceRatio);
    event LiquidationRatiosUpdated(bytes32 types, uint liquidationRatio);
}
