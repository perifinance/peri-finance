pragma solidity 0.5.16;

import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./LimitedSetup.sol";

import "./SafeDecimalMath.sol";

import "./interfaces/IStakingState.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/ILiquidations.sol";

contract ExternalTokenStakeManager is Owned, MixinResolver, MixinSystemSettings, LimitedSetup(8 weeks) {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    IStakingState public stakingState;

    bytes32 internal constant pUSD = "pUSD";
    bytes32 internal constant PERI = "PERI";
    bytes32 internal constant USDC = "USDC";

    bytes32 public constant CONTRACT_NAME = "ExternalTokenStakeManager";

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";
    bytes32 private constant CONTRACT_LIQUIDATIONS = "Liquidations";

    // This key order is used from unstaking multiple coins
    // bytes32[] public currencyKeyOrder;

    constructor(
        address _owner,
        address _stakingState,
        address _resolver
    ) public Owned(_owner) MixinSystemSettings(_resolver) {
        stakingState = IStakingState(_stakingState);
    }

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](3);

        newAddresses[0] = CONTRACT_ISSUER;
        newAddresses[1] = CONTRACT_EXRATES;
        newAddresses[2] = CONTRACT_LIQUIDATIONS;

        return combineArrays(existingAddresses, newAddresses);
    }

    function tokenInstance(bytes32 _currencyKey) internal view tokenRegistered(_currencyKey) returns (IERC20) {
        return IERC20(stakingState.tokenAddress(_currencyKey));
    }

    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXRATES));
    }

    function liquidations() internal view returns (ILiquidations) {
        return ILiquidations(requireAndGetAddress(CONTRACT_LIQUIDATIONS));
    }

    function getTokenList() external view returns (bytes32[] memory) {
        return stakingState.getTokenCurrencyKeys();
    }

    function getTokenAddress(bytes32 _currencyKey) external view returns (address) {
        return stakingState.tokenAddress(_currencyKey);
    }

    function getTokenDecimals(bytes32 _currencyKey) external view returns (uint8) {
        return stakingState.tokenDecimals(_currencyKey);
    }

    function getTokenActivation(bytes32 _currencyKey) external view returns (bool) {
        return stakingState.tokenActivated(_currencyKey);
    }

    // function getCurrencyKeyOrder() external view returns (bytes32[] memory) {
    //     return currencyKeyOrder;
    // }

    function combinedStakedAmountOf(address _user, bytes32 _unitCurrency)
        external
        view
        returns (
            uint combinedSA /* , uint minDecimals */
        )
    {
        return _combinedStakedAmountOf(_user, _unitCurrency);
    }

    function compiledStakableAmountOf(address _user, bytes32 _unitCurrency) external view returns (uint) {
        return _compiledStakableAmountOf(_user, _unitCurrency);
    }

    function getExEADebt(address _account)
        external
        view
        returns (
            uint exDebt,
            uint exEA,
            uint exTRatio
        )
    {
        (exDebt, exEA, exTRatio) = _calcExEADebt(_account);
    }

    function getExDebt(address _account) external view returns (uint exDebt) {
        return _calcExDebt(_account);
    }

    function getTargetRatio(address _account, uint _existDebt)
        external
        view
        returns (
            uint tRatio,
            uint exTSR,
            uint exEA
        )
    {
        (tRatio, exTSR, exEA) = _getTRatio(_account, _existDebt);
    }

    function exStakingRatio(address _account) external view returns (uint) {
        return _exStakingRatio(_account, _targetRatio(_account));
    }

    /* 
    function calcUnstakeAmt(address _account, uint _amount, uint _existDebt, uint _periCol, bytes32 _targetKey) 
        external view returns(uint exRefundAmt) {
        return _calcUnstakeAmt(_account, _amount, _existDebt, _periCol, _targetKey);
    } */

    /* function issuableDebtToMaxQ(address _account, uint _existDebt, bytes32 _targetKey, bytes32 _unitKey)
        external view returns (uint) {
        (uint issuable,) = _maxStakableAmountOf(_account, _existDebt, _targetKey, _unitKey);
        return _preciseMulToDecimal(issuable, _targetRatio(_account));
    }*/

    function maxStakableAmountOf(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    )
        external
        view
        returns (
            uint maxAmount /* , uint tRatio */
        )
    {
        // return _maxStakableAmountOf(_account, _existDebt, _targetKey, _unitKey);
        // (maxAmount, exTRatio, tRatio) = _maxExStakableAmt(_account, _existDebt, _periCol, _targetKey);
        (
            ,
            ,
            /* tRatio */
            maxAmount
        ) = _getTRAddDebtOrAmt(_account, _existDebt, 0, _periCol, _targetKey);
        // uint stakingAmt = _toCurrency(_unitKey, _targetKey, maxAmount);

        // uint targetDecimals = stakingState.tokenDecimals(_targetKey);

        // stakingAmt = stakingAmt.roundDownDecimal(uint(18).sub(targetDecimals));

        // maxAmount = stakingAmt.div(10**(uint(18).sub(targetDecimals)));
    }

    // function getAddDebtSA(address _account, uint _existDebt, uint _amount, uint _periCol, bytes32 _targetKey)
    //     external view returns (uint tRatio, uint addDebt, uint addableAmt) {
    //     return _getTRAddDebtOrAmt(_account, _existDebt, _amount, _periCol, _targetKey);
    // }

    function maxExAmtToTRatio(
        address _account,
        uint _existDebt,
        bytes32 _unitKey
    ) external view returns (uint) {
        return _maxExAmtToTRatio(_account, _existDebt, _unitKey);
    }

    function burnAmtToFitTR(
        address _account,
        uint _existDebt,
        uint _periCol
    )
        external
        view
        returns (
            uint burnAmount,
            uint exRefundAmt,
            uint exEA
        )
    {
        return _burnAmtToFitTR(_account, _existDebt, _periCol);
    }

    function calcTRatio(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    )
        external
        view
        returns (
            uint tRatio,
            uint exTRatio,
            uint eaSaGap
        )
    {
        return _calcTRatio(_account, _existDebt, _periCol, _targetKey);
    }

    function calcTokenSR(
        uint exTR,
        uint tokenIR,
        uint otherIR
    ) external pure returns (uint) {
        return _tokenSR(exTR, tokenIR, otherIR);
    }

    /**
     * @notice calculate the pUSD value of the external tokens in user's wallet.
     * @dev external view function
     * @param _user user's wallet address
     * @param _currencyKey target currency key to be calculated
     */
    function getTokenPUSDValueOf(address _user, bytes32 _currencyKey) external view returns (uint) {
        return _tokenPUSDValueOf(_user, _currencyKey);
    }

    function getTRatioCRatio(
        address _account,
        uint existDebt,
        uint periCol
    )
        external
        view
        returns (
            uint tRatio,
            uint cRatio,
            uint exSR,
            uint exEA /* , uint minDecimals */
        )
    {
        (
            tRatio,
            exSR,
            exEA /* , minDecimals */
        ) = _getTRatio(_account, existDebt);

        uint totalSA = periCol.add(exEA);

        cRatio = totalSA > 0 ? existDebt.divideDecimal(totalSA) : 0;
    }

    /**
     *
     * @param _account user's wallet address
     * @param _amount the amount of debt to be removed
     * @param _unitKey the unit currency key for the amount
     */
    function proRataUnstake(
        address _account,
        uint _amount,
        bytes32 _unitKey
    ) external returns (uint remainAmt) {
        // get ex-staked amount in unit currency
        (uint exDebt, uint exEA, uint exTRatio) = _calcExEADebt(_account);
        require(exDebt >= _amount, "Not enough external staked amount");

        _amount = _preciseDivToDecimal(_amount, exTRatio);

        // remainAmt = _amount > exEA ?  _amount.sub(exEA) : 0;

        // remainAmt = remainAmt.add(_proRataUnstake(_account, _account, _amount, exEA, _unitKey));

        remainAmt = _proRataUnstake(_account, _account, _amount, exEA, _unitKey);
    }

    /*     function proRataRefundAmt(address _account, uint _amount, bytes32 _unitKey) external view returns (uint overAmt, uint remainAmt) {
        (uint exDebt, uint exEA, uint exTRatio) = _calcExEADebt(_account);
        if(exDebt < _amount) return (_amount.sub(exDebt), 0);

        _amount = _preciseDivToDecimal(_amount, exTRatio);

        (_amount, overAmt) = _amount > exEA ? (exEA, _amount.sub(exEA)) : (_amount, 0);

        remainAmt = _proRataRefundAmt(_account, _amount, exEA, _unitKey);
    }
 */
    /**
     * @notice calculate the pUSD value of the external tokens in user's wallet.
     * @dev internal view function
     * @param _user user's wallet address
     * @param _currencyKey target currency key to be calculated
     */
    function _tokenPUSDValueOf(address _user, bytes32 _currencyKey) internal view returns (uint) {
        (uint tokenRate, bool rateIsInvalid) = exchangeRates().rateAndInvalid(_currencyKey);

        _requireRatesNotInvalid(rateIsInvalid);

        IERC20 exToken = tokenInstance(_currencyKey);

        uint balance = exToken.balanceOf(_user).mul(10**(uint(18).sub(exToken.decimals())));

        return balance.multiplyDecimal(tokenRate);
    }

    /**
     * @notice calculate the max pUSD value of the external tokens in user's wallet.
     *
     * @param _user user's wallet address
     * @param _currencyKey target currency key to be calculated
     */
    function maxSAPulsTokensOf(address _user, bytes32 _currencyKey) external view returns (uint maxStakableAmt) {
        require(_currencyKey != pUSD && _currencyKey != PERI, "PERI and pUSD not allowed");

        maxStakableAmt = _combinedStakedAmountOf(_user, pUSD);
        return maxStakableAmt.add(_tokenPUSDValueOf(_user, _currencyKey));
    }

    function expectedTargetRatios(
        address _account,
        uint _existDebt,
        uint _amount,
        bytes32 _targetKey,
        bool _stake
    )
        external
        view
        returns (
            uint exTargetRatio,
            uint targetRatio,
            uint changedAmt
        )
    {
        (exTargetRatio, targetRatio, changedAmt) = _expectedTargetRatios(_account, _existDebt, _amount, _targetKey, _stake);
    }

    function stakedAmountOf(
        address _user,
        bytes32 _currencyKey,
        bytes32 _unitCurrency
    ) external view returns (uint) {
        return _stakedAmountOf(_user, _currencyKey, _unitCurrency);
    }

    function _stakedAmountOf(
        address _user,
        bytes32 _currencyKey,
        bytes32 _unitCurrency
    ) internal view returns (uint amountOf) {
        amountOf = stakingState.stakedAmountOf(_currencyKey, _user);

        if (amountOf == 0) {
            return 0;
        }

        if (_currencyKey == _unitCurrency) {
            return amountOf;
        }

        amountOf = _toCurrency(_currencyKey, _unitCurrency, amountOf);
        // amountOf = amountOf.roundDownDecimal(uint(18).sub(stakingState.tokenDecimals(_currencyKey)));
    }

    // function requireNotExceedsQuotaLimit(
    //     address _account,
    //     uint _debtBalance,
    //     uint _additionalpUSD,
    //     uint _additionalExToken,
    //     bool _isIssue
    // ) external view {
    //     uint estimatedExternalTokenQuota =
    //         externalTokenQuota(_account, _debtBalance, _additionalpUSD, _isIssue);

    //     bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();
    //     uint minDecimals = 18;
    //     for (uint i; i < tokenList.length; i++) {
    //         uint decimals = stakingState.tokenDecimals(tokenList[i]);

    //         minDecimals = decimals < minDecimals ? decimals : minDecimals;
    //     }

    //     require(
    //         // due to the error caused by decimal difference, round down it upto minimum decimals among staking token list.
    //         estimatedExternalTokenQuota.roundDownDecimal(uint(18).sub(minDecimals)) <= getExternalTokenQuota(),
    //         "External token staking amount exceeds quota limit"
    //     );
    // }

    // /**
    //  * @notice It calculates the quota of user's staked amount to the debt.
    //  *         If parameters are not 0, it estimates the quota assuming those value is applied to current status.
    //  *
    //  * @param _account account
    //  * @param _debtBalance Debt balance to estimate [USD]
    //  * @param _addAmt amount to ex-staked amount [USD]
    //  * @param _isIssue If true, it is staking. Otherwise, it is unstaking.
    //  */
    /* function externalTokenQuota(
        address _account,
        uint _debtBalance,
        uint _addAmt,
        bool _isIssue
    ) external view returns (uint exTargetRatio) {
        // (exTargetRatio, , ) = _expectedTargetRatios(_account, _debtBalance, _addAmt, USDC, _isIssue);
    } */
    function _getTRatio(address _account, uint _existDebt)
        internal
        view
        returns (
            uint tRatio,
            uint exTSR,
            uint exEA /* , uint minDecimals */
        )
    {
        if (_existDebt == 0) {
            return (
                getIssuanceRatio(),
                0,
                0 /* , 18 */
            );
        }

        // get tokenEA, otherEA, tokenIR, otherIR
        uint otherIR;
        uint otherEA;
        uint tokenIR;
        uint tokenEA;
        uint exDebt;
        (
            otherIR,
            otherEA,
            tokenIR,
            tokenEA,
            exDebt /* , minDecimals */
        ) = _otherTokenIREA(_account, USDC);

        // get exEA
        exEA = tokenEA.add(otherEA);

        if (exEA == 0) {
            return (
                getIssuanceRatio(),
                0,
                0 /* , 18 */
            );
        }

        // get peri SA = periDebt / peri issuance ratio
        otherEA = _existDebt > exDebt ? _preciseDivToDecimal(_existDebt.sub(exDebt), getIssuanceRatio()) : 0;

        // get external Target Staking Ratio and save it to otherEA
        exTSR = _existDebt > 0 ? exEA.divideDecimal(exEA.add(otherEA)) : 0;

        // get exTRatio (Te = To - (To - Tt) * St)
        tRatio = _toTRatio(otherIR, tokenIR, tokenEA.divideDecimal(exEA));

        // // Se-max = (Tmax - Tp) / (Te - Tp)
        // otherIR = _preciseDivToDecimal(getExternalTokenQuota().sub(getIssuanceRatio()), tRatio.sub(getIssuanceRatio()));
        // exTSR = otherIR < exTSR ? otherIR : exTSR;

        // get TRatio (Tp + ( Te - Tp) * Se)
        tRatio = _toTRatio(getIssuanceRatio(), tRatio, exTSR);

        tRatio = tRatio > getExternalTokenQuota() ? getExternalTokenQuota() : tRatio < getIssuanceRatio()
            ? getIssuanceRatio()
            : tRatio;
    }

    function _targetRatio(address _account) internal view returns (uint tRatio) {
        tRatio = stakingState.getTargetRatio(_account);
        tRatio = tRatio == 0 ? getIssuanceRatio() : tRatio;
    }

    function _rateCheck(bytes32 _currencyKey) internal view returns (uint rate) {
        bool isInvalid;
        (rate, isInvalid) = exchangeRates().rateAndInvalid(_currencyKey);
        _requireRatesNotInvalid(isInvalid);
    }

    function _preciseMul(uint x, uint y) internal pure returns (uint) {
        return (y == 0 || x == 0) ? 0 : x.decimalToPreciseDecimal().multiplyDecimalRoundPrecise(y.decimalToPreciseDecimal());
    }

    function _preciseDiv(uint x, uint y) internal pure returns (uint) {
        return (y == 0 || x == 0) ? 0 : x.decimalToPreciseDecimal().divideDecimalRoundPrecise(y.decimalToPreciseDecimal());
    }

    function _preciseMulToDecimal(uint x, uint y) internal pure returns (uint) {
        return (y == 0 || x == 0) ? 0 : _preciseMul(x, y).preciseDecimalToDecimal();
    }

    function _preciseDivToDecimal(uint x, uint y) internal pure returns (uint) {
        return (y == 0 || x == 0) ? 0 : _preciseDiv(x, y).preciseDecimalToDecimal();
    }

    /**
     * @notice calculate the total staked value of the external tokens of the staker in given currency unit.
     *
     * @param _user staker address
     * @param _unitCurrency The currency unit to be applied for estimation [USD]
     */
    function _combinedStakedAmountOf(address _user, bytes32 _unitCurrency)
        internal
        view
        returns (
            uint combinedStakedAmount /* , uint minDecimals */
        )
    {
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();
        // minDecimals = 18;
        for (uint i; i < tokenList.length; i++) {
            uint stakedAmount = _stakedAmountOf(_user, tokenList[i], _unitCurrency);

            if (stakedAmount == 0) {
                continue;
            }

            combinedStakedAmount = combinedStakedAmount.add(stakedAmount);

            // uint decimals = stakingState.tokenDecimals(tokenList[i]);
            // minDecimals = decimals < minDecimals ? decimals : minDecimals;
        }
    }

    /**
     * @notice calculate stakable amount of the external tokens in the staker's wallet.
     *
     * @return stakable amount of the external tokens in the staker's wallet.
     * @param _user staker address
     * @param _unitCurrency The currency unit to be applied for estimation [USD]
     */
    function _compiledStakableAmountOf(address _user, bytes32 _unitCurrency)
        internal
        view
        returns (uint compiledStakableAmount)
    {
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();

        for (uint i; i < tokenList.length; i++) {
            uint _stakedAmount = stakingState.stakedAmountOf(tokenList[i], _user);

            if (_stakedAmount == 0) {
                continue;
            }

            _stakedAmount =
                tokenInstance(tokenList[i]).balanceOf(_user).mul(10**(18 - (uint)(tokenInstance(tokenList[i]).decimals()))) -
                _stakedAmount;

            compiledStakableAmount = compiledStakableAmount.add(_toCurrency(tokenList[i], _unitCurrency, _stakedAmount));
        }
    }

    /**
     * @notice calculate the value in given currency unit.
     *
     * @return convAmt the value in given currency unit.
     * @param _fromKey The currency key of the external token
     * @param _toKey The currency key to be converted
     * @param _amount The amount of the external token
     */
    function _toCurrency(
        bytes32 _fromKey,
        bytes32 _toKey,
        uint _amount
    ) internal view returns (uint convAmt) {
        if (_fromKey == _toKey) {
            return _amount;
        }

        convAmt = _amount;
        // uint amountToUSD;
        uint rate;
        bool rateIsInvalid;
        if (_fromKey != pUSD) {
            // if (_fromKey == pUSD) {
            //     amountToUSD = _amount;
            // } else {
            (rate, rateIsInvalid) = exchangeRates().rateAndInvalid(_fromKey);

            _requireRatesNotInvalid(rateIsInvalid);

            // amountToUSD = _amount.multiplyDecimalRound(rate);
            // convAmt = _amount.multiplyDecimalRound(rate);
            convAmt = _preciseMulToDecimal(_amount, rate);
        }

        if (_toKey != pUSD) {
            // if (_toKey == pUSD) {
            //     return amountToUSD;
            // } else {
            (rate, rateIsInvalid) = exchangeRates().rateAndInvalid(_toKey);

            _requireRatesNotInvalid(rateIsInvalid);

            // return convAmt.divideDecimalRound(rate);
            // convAmt = convAmt.divideDecimalRound(rate);
            convAmt = _preciseDivToDecimal(convAmt, rate);
        }
    }

    /**
     * @notice Utils checking given two key arrays' value are matching each other(its order will not be considered).
     */
    function _keyChecker(bytes32[] memory _keysA, bytes32[] memory _keysB) internal pure returns (bool) {
        if (_keysA.length != _keysB.length) {
            return false;
        }

        for (uint i; i < _keysA.length; i++) {
            bool exist;
            for (uint j; j < _keysA.length; j++) {
                if (_keysA[i] == _keysB[j]) {
                    exist = true;

                    break;
                }
            }

            // given currency key is not matched
            if (!exist) {
                return false;
            }
        }

        return true;
    }

    function _calcExDebt(address _account) internal view returns (uint exDebt) {
        // get exEA
        (, , , , exDebt) = _otherTokenIREA(_account, USDC);

        // get exDebt = tokenEA * tokenIR + otherEA * otherIR
        // exDebt = _preciseMulToDecimal(tokenEA, tokenIR).add(
        //     _preciseMulToDecimal(otherEA, otherIR)
        // );
    }

    // function _calcTotalSA(address _account, uint _existDebt)
    //     internal view returns (uint totalSA, uint exEA, uint exDebt) {
    //     (exDebt, exEA,) = _calcExDebt(_account);

    //     // get peri debt amount
    //     totalSA = _preciseDivToDecimal(_existDebt.sub(exDebt), getIssuanceRatio());
    // }

    function _calcExEADebt(address _account)
        internal
        view
        returns (
            uint exDebt,
            uint exEA,
            uint exTRatio /* , uint minDecimals */
        )
    {
        // get exEA
        uint otherIR;
        uint otherEA;
        uint tokenIR;
        uint tokenEA;
        (otherIR, otherEA, tokenIR, tokenEA, exDebt) = _otherTokenIREA(_account, USDC);

        // // get exDebt = tokenEA * tokenIR + otherEA * otherIR
        // exDebt = _preciseMulToDecimal(tokenEA, tokenIR).add(
        //     _preciseMulToDecimal(otherEA, otherIR)
        // );

        // get exEA
        exEA = tokenEA.add(otherEA);

        // get exTRatio
        exTRatio = exEA > 0 ? _toTRatio(otherIR, tokenIR, tokenEA.divideDecimal(exEA)) : SafeDecimalMath.unit();
    }

    /**
     * @notice calculate unstake amount of the external tokens with the given amount and debt
     *
     * @param _account staker address
     * @param _amount the amount of debt to be removed
     * @param _existDebt existing debt amount
     * @param _periCol PERI collateral amount
     * @param _targetKey external token key
     *
     * @return exRefundAmt unstaking ex-token amount in pUSD
     */
    function _calcUnstakeAmt(
        address _account,
        uint _amount,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    ) internal view returns (uint exRefundAmt) {
        exRefundAmt = _calcExDebt(_account);

        // calc peri debt amount
        uint periDebt = _existDebt > exRefundAmt ? _existDebt.sub(exRefundAmt) : 0;

        // get peri estimated debt from the collateral value
        uint periCol2Debt = _preciseMulToDecimal(_periCol, getIssuanceRatio());

        // calc the gap between periDebt and periCol2Debt and check if it is short or long
        exRefundAmt = periDebt > periCol2Debt ? periDebt.sub(periCol2Debt) : 0;

        // in case short, check if the amount is more than the gap. if amount > gap, unstake amount = amount - gap else amount itself
        // in case long, unstake amount is amount + gap
        exRefundAmt = exRefundAmt > 0
            ? _amount > exRefundAmt ? _preciseMulToDecimal(_amount.sub(exRefundAmt), getExTokenIssuanceRatio(_targetKey)) : 0
            : _preciseMulToDecimal(_amount, getExTokenIssuanceRatio(_targetKey));
    }

    /**
     * @notice get the other token's Issuance Ratio and Staked Amount
     * (if the target token is stable, this is gold token such as PAXG or vice versa)
     *
     * @param _account staker address
     * @param _targetKey external token key
     *
     * @return otherIR other token's Issuance Ratio
     * @return otherEA other token's Staked Amount
     * @return tokenIR target token's Issuance Ratio
     */
    function _otherTokenIREA(address _account, bytes32 _targetKey)
        internal
        view
        returns (
            uint otherIR,
            uint otherEA,
            uint tokenIR,
            uint tokenEA,
            uint exDebt /* , uint minDecimals */
        )
    {
        tokenIR = getExTokenIssuanceRatio(_targetKey);
        uint minDecimals = 18;
        uint oMinDecimals = 18;
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();
        for (uint i; i < tokenList.length; i++) {
            exDebt = _stakedAmountOf(_account, tokenList[i], pUSD);
            if (tokenIR != getExTokenIssuanceRatio(tokenList[i])) {
                otherIR = getExTokenIssuanceRatio(tokenList[i]);
                if (exDebt > 0) {
                    otherEA = otherEA.add(exDebt);
                    exDebt = stakingState.tokenDecimals(tokenList[i]);
                    oMinDecimals = oMinDecimals < exDebt ? oMinDecimals : exDebt;
                }
            } else if (exDebt > 0) {
                tokenEA = tokenEA.add(exDebt);
                exDebt = stakingState.tokenDecimals(tokenList[i]);
                minDecimals = minDecimals < exDebt ? minDecimals : exDebt;
            }
        }

        exDebt = _preciseMulToDecimal(tokenEA, tokenIR).roundDownDecimal(uint(18).sub(minDecimals)).add(
            _preciseMulToDecimal(otherEA, otherIR).roundDownDecimal(uint(18).sub(oMinDecimals))
        );

        // minDecimals = minDecimals < oMinDecimals ? minDecimals : oMinDecimals;
    }

    function otherTokenIREA(address _account, bytes32 _targetKey)
        external
        view
        returns (
            uint otherIR,
            uint otherEA,
            uint tokenIR,
            uint tokenEA /* , uint minDecimals */
        )
    {
        (otherIR, otherEA, tokenIR, tokenEA, ) = _otherTokenIREA(_account, _targetKey);
    }

    /**
     * @notice get total external tokens' staking ratio
     *
     * @param _account staker address
     * @param targetRatio external tokens' target ratio
     */
    function _exStakingRatio(address _account, uint targetRatio) internal view returns (uint exSR) {
        // if target ratio is 0, return exSR 0
        // if (targetRatio == getIssuanceRatio()) {
        //     return 0;
        // }

        // get external tokens' target ratio
        exSR = stakingState.getExTargetRatio(_account);

        // get total external tokens' target ratio
        // Ex-Staking Ratio = (Target Ratio - Peri Issuance Ratio) / (Sum of Ex-Token Target Ratio - Peri Issuance Ratio)
        exSR = _preciseDivToDecimal(targetRatio.sub(getIssuanceRatio()), exSR.sub(getIssuanceRatio()));
    }

    /**
     * @notice get target token's staking ratio
     * @dev St = (To-Te) / (To-Tt)
     * @param exTR external token's target ratio
     * @param tokenIR target token's issuance ratio
     * @param otherIR the other token's issuance ratio
     */
    function _tokenSR(
        uint exTR,
        uint tokenIR,
        uint otherIR
    ) internal pure returns (uint tokenSR) {
        // get target token's staking ratio
        // Token Staking Ratio = +/-( Ex-Target Ratio - Token Issuance Ratio ) / +/-( Token Issuance Ratio - Other Issuance Ratio )
        tokenSR = tokenIR > otherIR
            ? _preciseDivToDecimal(exTR.sub(otherIR), tokenIR.sub(otherIR))
            : _preciseDivToDecimal(otherIR.sub(exTR), otherIR.sub(tokenIR));
    }

    /**
     * @notice get target token's staking ratio and the other token's issuance ratio(if the target token is stable, this is Gold token such as PAXG)
     * @dev only keeps 2 types of external tokens' staking ratio. one is
     * , the other is non-stables such as PAXG.
     * @param _account staker address
     * @param _targetKey external token key
     *
     * @return tokenER target token's staking ratio
     * @return otherIR the other token's issuance ratio
     * @return tokenIR target token's issuance ratio
     */
    function _tokenER(address _account, bytes32 _targetKey)
        internal
        view
        returns (
            uint tokenER,
            uint otherIR,
            uint tokenIR
        )
    {
        // get the other token's issuance ratio if the target token is stable, it is non-stable token such as PAXG
        // tokenER(Estimated Value Ratio) = otherEA(other type's Estimated Value Amount) at the moment
        uint tokenEA;
        (otherIR, tokenER, tokenIR, tokenEA, ) = _otherTokenIREA(_account, _targetKey);

        // if there is no other token, return tokenER 0, otherIR, tokenIR
        if (tokenEA == 0) {
            return (0, otherIR, tokenIR);
        }

        // get target token's estimated value ratio tokenER = tokenEA / ( tokenEA + otherEA )
        tokenER = _preciseDivToDecimal(tokenEA, tokenEA.add(tokenER));
    }

    /**
     * @notice get max ex-tokens' stakable amount in _unitKey for the current target ratio
     *
     * @param _account staker address
     * @param _existDebt existing debt amount
     * @param _unitKey external token key
     *
     * @return maxAmount max ex-tokens' stakable amount in _unitKey for the current target ratio
     */
    function _maxExAmtToTRatio(
        address _account,
        uint _existDebt,
        bytes32 _unitKey
    ) internal view returns (uint maxAmount) {
        uint tRatio = _targetRatio(_account);
        // get max stakable amount : maxAmt = Debt Balance * Staking Ratio / Target Ratio
        maxAmount = _preciseMulToDecimal(_existDebt, _exStakingRatio(_account, tRatio));
        maxAmount = _preciseDivToDecimal(maxAmount, tRatio);

        // convert maxAmount to _unitKey
        if (_unitKey != pUSD) {
            maxAmount = _preciseDivToDecimal(maxAmount, _rateCheck(_unitKey));
        }
    }

    /**
     * @notice get burn amount to meet the current target ratio
     *
     * @param _account staker address
     * @param _existDebt existing debt amount
     * @param _periCol PERI collateral amount
     *
     * @return burnAmount burn amount
     * @return exRefundAmt ex-refund amount
     */
    function _burnAmtToFitTR(
        address _account,
        uint _existDebt,
        uint _periCol
    )
        internal
        view
        returns (
            uint burnAmount,
            uint exRefundAmt,
            uint exEA
        )
    {
        // get ex-debt and ex-staked amount
        uint exDebt;
        uint exTRatio;
        (exDebt, exEA, exTRatio) = _calcExEADebt(_account);

        /* // get total SA(D) 
        uint tmpEA = _existDebt > exDebt
            ? _preciseDivToDecimal(_existDebt.sub(exDebt), getIssuanceRatio()).add(exEA)
            : exEA; //_preciseDivToDecimal(_existDebt, exTRatio);

        // calc max ex-token value upto max target ratio(0.5)
        // maxAmt = { (Tmax - Tp) * V + (Te - Tp) * Ve } / (Te - Tmax)
        tmpEA = _preciseMulToDecimal(tmpEA, getExternalTokenQuota().sub(getIssuanceRatio()));
        uint tmpExEA = _preciseMulToDecimal(tmpEA, exTRatio.sub(getIssuanceRatio()));
        exRefundAmt = tmpExEA > tmpEA 
            ? _preciseDivToDecimal(tmpExEA.sub( exEA ), exTRatio.sub(getExternalTokenQuota()))
            : 0;

        exDebt = exRefundAmt > 0 
            ? _preciseMulToDecimal(exEA.sub(exRefundAmt), exTRatio)
            : exDebt;

        // get peri estimated debt from the collateral value
        uint periCol2Debt = _preciseMulToDecimal(_periCol, getIssuanceRatio());

        // get periDebt
        uint periDebt = _existDebt.sub(exDebt);
        burnAmount = periDebt > periCol2Debt ? periDebt.sub(periCol2Debt) : 0; */
        uint periIR = getIssuanceRatio();
        uint maxSR = getExternalTokenQuota();

        // get ex-staking ratio for max target ratio(0.5)
        // Se-max = (Tmax - Tp) / (Te - Tp)
        uint tmpExSR = _preciseDivToDecimal(maxSR.sub(periIR), exTRatio.sub(periIR));

        // get exSA for max target ratio(0.5) and save it to tmpExEA
        uint tmpExEA = _preciseDivToDecimal(_existDebt, maxSR);
        tmpExEA = _preciseMulToDecimal(tmpExEA, tmpExSR);

        // get peri estimated debt from the collateral value
        uint periCol2Debt = _preciseMulToDecimal(_periCol, periIR);

        // in case exDebt > maxExDebt, periDebt = existDebt - maxExDebt,
        // otherwiase periDebt = existDebt - exDebt
        uint periDebt = exEA > tmpExEA ? _existDebt.sub(_preciseMulToDecimal(tmpExEA, exTRatio)) : _existDebt.sub(exDebt);

        // when periDebt is bigger than peri collateral-converted debt
        if (periDebt > periCol2Debt) {
            // fix max EX-token Staking Amount with peri's collateral and max exSR (exSA = periCol * exSR / (1 - exSR)
            tmpExEA = _preciseDivToDecimal(_preciseMulToDecimal(_periCol, tmpExSR), SafeDecimalMath.unit().sub(tmpExSR));

            // calc max debt amount by adding periCol2Debt and max exDebt
            exDebt = periCol2Debt.add(exEA > tmpExEA ? _preciseMulToDecimal(tmpExEA, exTRatio) : exDebt);
            // calc burn amount by substracting sum of max exDebt and periCol2Debt from existDebt
            burnAmount = _existDebt > exDebt ? _existDebt.sub(exDebt) : 0;

            // // calc exRefundAmt by substracting max ex-tokens' SA from ex-tokens' SA
            // exRefundAmt = tmpExEA >= exEA ? exEA.sub(tmpExEA) : 0;
        }

        // calc exRefundAmt by substracting max ex-tokens' SA from ex-tokens' SA
        exRefundAmt = exEA > tmpExEA ? exEA.sub(tmpExEA) : 0;

        /* uint periDebt;
        // if exDebt is bigger than max exDebt
        if (exEA > tmpExEA) {
            // convert the exSA to exDebt for max target ratio(0.5) and get periDebt
            periDebt = _existDebt.sub(tmpExEA.multiplyDecimal(exTRatio));

            // when periDebt is bigger than peri collateral-converted debt
            if (periDebt > periCol2Debt) {

                // calc max EX-token Staking Amount with peri's collateral and max exSR
                tmpExEA = _periCol.multiplyDecimal(tmpExSR).divideDecimal(SafeDecimalMath.unit().sub(tmpExSR));

                // calc burn amount by substracting sum of max exDebt and periCol2Debt from existDebt
                burnAmount = _existDebt.sub(periCol2Debt.add(tmpExEA.multiplyDecimal(exTRatio)));
            }

            // calc exRefundAmt by substracting max ex-tokens' SA from ex-tokens' SA
            exRefundAmt = exEA.sub(tmpExEA);

        // when exDebt is smaller than max exDebt
        } else {
            // get periDebt
            periDebt = _existDebt.sub(exDebt);
            // burnAmount = (periDebt > periCol2Debt) ? periDebt.sub(periCol2Debt) : 0;
            if (periDebt > periCol2Debt) {

                // calc max EX-token Staking Amount with peri's collateral and max exSR
                tmpExEA = _periCol.multiplyDecimal(tmpExSR).divideDecimal(SafeDecimalMath.unit().sub(tmpExSR));

                // calc burn amount by substracting sum of max exDebt and periCol2Debt from existDebt
                burnAmount = _existDebt.sub(periCol2Debt.add(tmpExEA.multiplyDecimal(exTRatio)));

                // calc exRefundAmt by substracting max ex-tokens' SA from ex-tokens' SA
                exRefundAmt = exEA.sub(tmpExEA);
            }
            
        } */
    }

    /**
     * @notice get needed ex-tokens amount in _unitKey to meet max target ratio (ex. 0.5)
     * @dev needed amount(to max target ratio)
     *      X = { ( Tt - Tp ) * Vt + ( To - Tp ) * Do - ( Tmax - Tp ) * (D - Dt + Vt) } / ( Tmax - Tt )
     * @param _account staker address
     * @param _existDebt existing debt amount
     * @param _unitKey external token key
     *
     * @return exTRatio ex-tokens' staking ratio
     * @return addableAmt needed ex-tokens amount in _unitKey to meet max target ratio (ex. 0.5)
     */
    function _maxStakableAmountOf(
        address _account,
        uint _existDebt,
        bytes32 _targetKey,
        bytes32 _unitKey
    ) internal view returns (uint exTRatio, uint addableAmt) {
        // get tokenEA(Vt), tokenIR(Tt), otherEA, otherIR(To) and decimals
        (uint otherIR, uint otherEA, uint tokenIR, uint tokenEA, ) = _otherTokenIREA(_account, _targetKey);

        exTRatio = _targetRatio(_account);

        // get total SA(D) : totalSA = _existDebt / Target Ratio
        uint debt2ToSA = _existDebt.divideDecimal(exTRatio);

        // get ex-staking ratio(exSR) and ex-staked amount(exSA)
        uint exSA = debt2ToSA.multiplyDecimal(_exStakingRatio(_account, exTRatio));

        // if exSA < exEA return (0, 0)
        if (exSA < tokenEA.add(otherEA)) {
            return (0, 0);
        }

        // calc otherSA(Do) : otherSA = exSA * otherSR
        otherEA = exSA != 0
            ? _preciseMulToDecimal(_tokenSR(stakingState.getExTargetRatio(_account), otherIR, tokenIR), exSA)
            : 0;

        // get target token's stakable amount  getExternalTokenQuota() = Tmax
        // X = [ ( Tmax - Tp ) * (D + Vt - Dt) - { ( Tt - Tp ) * Vt + ( To - Tp ) * Do } ] / ( Tt - Tmax )
        // addableAmt = ( Tt - Tp ) * Vt : always Tt > Tp
        addableAmt = _preciseMulToDecimal(tokenIR.sub(getIssuanceRatio()), tokenEA);

        // addableAmt = addableAmt + ( To - Tp ) * Do : always To > Tp
        addableAmt = addableAmt.add(_preciseMulToDecimal(otherIR.sub(getIssuanceRatio()), otherEA));

        // calc tokenSA(Dt) : tokenSA = tokenSR * exSA
        exSA = exSA != 0
            ? _preciseMulToDecimal(_tokenSR(stakingState.getExTargetRatio(_account), tokenIR, otherIR), exSA)
            : 0;

        // debt2ToSA = ( Tmax - Tp ) * (D + Vt - Dt)
        debt2ToSA = _preciseMulToDecimal(getExternalTokenQuota().sub(getIssuanceRatio()), debt2ToSA.add(tokenEA).sub(exSA));

        // if target token's EA > target token's SA, return (token's SA, 0)
        if (debt2ToSA < addableAmt) {
            return (exSA, 0);
        }

        // addableAmt = ( Tmax - Tp ) * (D + Vt - Dt) - addableAmt : always Tmax > Tp
        addableAmt = debt2ToSA.sub(addableAmt);

        // addableAmt = addableAmt / ( Tt - Tmax )
        addableAmt = _preciseDivToDecimal(addableAmt, tokenIR.sub(getExternalTokenQuota()));

        // round down it upto minimum decimals among staking token list.
        addableAmt = addableAmt.roundDownDecimal(uint(18).sub(stakingState.tokenDecimals(_targetKey)));

        // we need to consider the decimals of the ex-token.
        // get all of _currencyKey token's amount of from the user wallet
        uint tokenPUSDValue = _tokenPUSDValueOf(_account, _targetKey);

        // cap the staking amount within the user's wallet amount
        addableAmt = tokenPUSDValue < addableAmt ? tokenPUSDValue : addableAmt;

        if (_unitKey != pUSD) {
            // addableAmt = _preciseDivToDecimal(addableAmt, _rateCheck(_unitKey));
            addableAmt = addableAmt.divideDecimal(_rateCheck(_unitKey));
        }

        // get token's staking ratio and save it to exTRatio
        exTRatio = tokenEA.add(addableAmt).divideDecimal(tokenEA.add(addableAmt).add(otherEA));

        // get exTRatio
        exTRatio = _toTRatio(otherIR, tokenIR, exTRatio);
    }

    /**
     * @notice get new target ratio of the staker
     * @dev _debt2TotSA should not be exeeded the staked tokens' total amount in USD, which means _debt2TotSA needs to be caluculated before calling this function.
     *      _debt2TotSA can be calculated by combinedStakedAmountOf() function or stakedAmountOf() function with token key.
     * @param _amount external token amount in USD
     * @param _debt2TotSA existing total staked amount based on the existing debt
     * @param _debt2ExSA external token's staking amount based on the existing debt
     * @param _periIR Peri Issuance Ratio
     * @param _exTargetRatio external token's target ratio
     * @param _stake if true, it is staking, otherwise unstaking
     */
    function _calcTargetRatio(
        uint _amount,
        uint _debt2TotSA,
        uint _debt2ExSA,
        uint _periIR,
        uint _exTargetRatio,
        bool _stake
    ) internal pure returns (uint estTargetRatio) {
        // if _ex-Staking Amount is 0, it means there is no external token staked yet, so _stake must be true
        if (!_stake && _debt2ExSA == 0) {
            return 0;
        }

        // get new staking ratio(var: estTargetRatio) :
        // Ex-Staking Ratio = (Staked Amount(Ex) +/- Ex-Staking Amount) / ( Staked Amount(Total) +/- Ex-Staking Amount)
        estTargetRatio = !_stake
            ? _debt2ExSA > _amount ? _debt2ExSA.sub(_amount).divideDecimal(_debt2TotSA.sub(_amount)) : 0 // : _preciseDivToDecimal(_debt2ExSA.add(_amount), _debt2TotSA.add(_amount));
            : _debt2ExSA.add(_amount).divideDecimal(_debt2TotSA.add(_amount));

        // get new target ratio(var: estTargetRatio) :
        // Target Ratio =  Peri Issuance Ratio - (Peri Issuance Ratio - Ex-Target Ratio) * Ex-Staking Ratio
        estTargetRatio = _toTRatio(_periIR, _exTargetRatio, estTargetRatio);
        // estTargetRatio = targetRatio.decimalToPreciseDecimal().multiplyDecimalRoundPrecise(SafeDecimalMath.unit().sub(estTargetRatio))
        //     .add(exTargetRatio.decimalToPreciseDecimal().multiplyDecimalRoundPrecise(estTargetRatio)).preciseDecimalToDecimal();
    }

    /**
     * @notice calculate new target ratios of the staker
     *
     * @param _account staker address
     * @param _existDebt existing debt amount
     * @param _amount adding/subtracting token value amount
     * @param _targetKey external token key
     * @param _stake if true, it is staking, otherwise unstaking
     *
     * @return exTargetRatio external token's target ratio
     * @return targetRatio total external tokens' target ratio
     * @return changedAmt if staking, CHANGED DEBT amount, if not, UNSTAKING amount in USD
     */
    function _expectedTargetRatios(
        address _account,
        uint _existDebt,
        uint _amount,
        bytes32 _targetKey,
        bool _stake
    )
        internal
        view
        returns (
            uint exTargetRatio,
            uint targetRatio,
            uint changedAmt
        )
    {
        // get the staker's Target Ratio
        targetRatio = _targetRatio(_account);

        // get the staker's existing staked amount in USD based on existing debt (debt / target ratio)
        uint debt2totSA = _preciseDivToDecimal(_existDebt, targetRatio);

        // get the staker's old external staked amount in USD based on the debt and the external staking ratio
        uint debt2ExSA = _preciseMulToDecimal(debt2totSA, _exStakingRatio(_account, targetRatio));

        // get the staker's External token Target Ratio
        (exTargetRatio, changedAmt) = _expectedExTargetRatio(_account, debt2ExSA, _amount, _targetKey, _stake);

        // get the staker's Target Ratio
        targetRatio = _calcTargetRatio(changedAmt, debt2totSA, debt2ExSA, getIssuanceRatio(), exTargetRatio, _stake);
    }

    /**
     * @notice calculate new ex-target ratio of the staker
     *
     * @param _account staker address
     * @param _debt2ExSA existing debt amount
     * @param _amount external token amount
     * @param _targetKey external token key
     * @param _stake if true, it is staking, otherwise unstaking
     *
     * @return exTRatio external token's target ratio
     * @return changedAmt if staking, CHANGED DEBT amount, if not, UNSTAKING amount in USD
     */
    function _expectedExTargetRatio(
        address _account,
        uint _debt2ExSA,
        uint _amount,
        bytes32 _targetKey,
        bool _stake
    ) internal view returns (uint exTRatio, uint changedAmt) {
        // get ex-target ratio
        exTRatio = stakingState.getExTargetRatio(_account);
        if (exTRatio == SafeDecimalMath.unit()) {
            return (getExTokenIssuanceRatio(_targetKey), _amount);
        }

        // get the other token's Issuance Ratio, target token's Issuance Ratio and target token's Staked Amount
        (uint otherIR, , uint tokenIR, uint tokenEA, ) = _otherTokenIREA(_account, _targetKey);

        // get target SR : St = (To-Te) / (To-Tt)
        uint tokenSR = _tokenSR(exTRatio, tokenIR, otherIR);

        // get target token's staked amount in USD based on the debt
        uint tokenSA = tokenSR != 0 ? _preciseMulToDecimal(_debt2ExSA, tokenSR) : 0;

        // applying the decimals of the target token.
        tokenSA = tokenSA.roundDownDecimal(uint(18).sub(stakingState.tokenDecimals(_targetKey)));

        // get SA change in order for debt change in USD
        changedAmt = tokenEA.add(_amount);
        _amount = _stake ? changedAmt > tokenSA ? changedAmt.sub(tokenSA) : 0 : tokenEA > tokenSA
            ? _amount > tokenEA.sub(tokenSA) ? _amount.sub(tokenEA.sub(tokenSA)) : _amount
            : _amount;

        // if _amount is 0, return exTRatio, 0
        if (_amount == 0) {
            return (exTRatio, 0);
        }

        // calc staking/ unstaking amount in USD
        changedAmt = _stake ? _amount : tokenSA >= tokenEA
            ? _amount >= tokenSA.sub(tokenEA) ? _amount.sub(tokenSA.sub(tokenEA)) : 0
            : _amount.add(tokenEA.sub(tokenSA));

        // calc new target token's Staking Ratio
        tokenSR = _stake ? tokenSA.add(_amount).divideDecimal(_debt2ExSA.add(_amount)) : tokenSA > _amount
            ? tokenSA.sub(_amount).divideDecimal(_debt2ExSA.sub(_amount))
            : 0;

        // get new ex-target ratio(var: exTRatio) :
        // Ex-Target Ratio = other Issuance Ratio - (other Issuance Ratio - token Issuance Ratio) * token Staking Ratio
        exTRatio = _toTRatio(otherIR, tokenIR, tokenSR);
    }

    function _toTRatio(
        uint _Tp,
        uint _Te,
        uint _Se
    ) internal pure returns (uint) {
        // Target Ratio =  Peri Issuance Ratio - (Peri Issuance Ratio - Ex-Staking Ratio) * Ex-Staking Ratio
        (uint temp, bool sub) = _Tp > _Te ? (_Tp.sub(_Te), true) : (_Te.sub(_Tp), false);

        return sub ? _Tp.sub(_preciseMulToDecimal(temp, _Se)) : _Tp.add(_preciseMulToDecimal(temp, _Se));
    }

    function calcInitTargetRatios(
        address _account,
        /* uint _existDebt, */
        uint _periCol
    )
        external
        view
        onlyIssuer
        returns (
            uint exTRatio,
            uint tRatio,
            uint maxIDebt
        )
    {
        return
            _calcInitTargetRatios(
                _account,
                /*  _existDebt, */
                _periCol
            );
    }

    /**
     * @notice calulate re-initializable the staker's Target Ratios
     *
     * @param _account staker address
     * @param _periCol Peri Collateral amount
     */
    function _calcInitTargetRatios(
        address _account,
        /* uint _existDebt, */
        uint _periCol
    )
        internal
        view
        returns (
            uint tRatio,
            uint exTRatio,
            uint maxIDebt
        )
    {
        // get the other token's issuance ratio that is non-stable token such as PAXG
        (uint otherIR, uint otherEA, uint tokenIR, uint tokenEA, ) = _otherTokenIREA(_account, USDC);

        // if no exEA, return tRatio 0.25
        if (otherEA == 0 && tokenEA == 0) {
            return (getIssuanceRatio(), SafeDecimalMath.unit(), _preciseMulToDecimal(getIssuanceRatio(), _periCol));
        }

        // get old target ratio
        tRatio = _targetRatio(_account);

        // get old total SA(D) : totalSA = _existDebt / Target Ratio
        // uint debt2totSA = _preciseDivToDecimal(_existDebt, tRatio);

        // calc ex-tokens's Estimated Value(exEA)
        tokenEA = otherEA.add(tokenEA);

        // calc the other token's staking ratio(ex: PAXG)
        uint otherSR = tokenEA > 0 ? _preciseDivToDecimal(otherEA, tokenEA) : 0;

        // Ex-Target Ratio = Stable Issuance Ratio - (Stable Issuance Ratio - Other(ex PAXG) Issuance Ratio) * Other(ex:PAXG) Staking Ratio
        exTRatio = otherSR > 0 ? _toTRatio(tokenIR, otherIR, otherSR) : SafeDecimalMath.unit();

        // sum ex-tokens' estimated value and peri collateral to get max stakable value { peri(all in the wallet) + ex-tokens(staked) }
        maxIDebt = _periCol.add(tokenEA);

        // calc new ex-token's staking ratio
        otherSR = tokenEA.divideDecimal(maxIDebt);

        // calc new target ratio
        // Target Ratio =  Peri Issuance Ratio - (Peri Issuance Ratio - Ex-Target Ratio) * Ex-Staking Ratio
        tRatio = _toTRatio(getIssuanceRatio(), exTRatio, otherSR);

        _requireOverIssuanceRatio(tRatio);

        // get max issuable debt : max issuable debt = (max issuable value - staked value) * tRatio
        maxIDebt = _preciseMulToDecimal(tRatio, maxIDebt);
    }

    /**
     * @notice get needed ex-tokens amount in _unitKey to meet max target ratio (ex. 0.5)
     * @dev needed amount(to max target ratio)
     *      X = { ( Tt - Tp ) * Vt + ( To - Tp ) * Vo - ( Tmax - Tp ) * V } / ( Tmax - Tt )
     * @param _account staker address
     * @param _existDebt existing debt amount
     * @param _periCol PERI collateral amount
     * @param _targetKey external token key
     *
     * @return exTRatio ex-tokens' staking ratio
     * @return addableAmt needed ex-tokens amount in _unitKey to meet max target ratio (ex. 0.5)
     */
    function _maxExStakableAmt(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    )
        internal
        view
        returns (
            uint addableAmt,
            uint exTRatio,
            uint tRatio
        )
    {
        // get tokenEA(Vt), tokenIR(Tt), otherEA(Vo), otherIR(To) and decimals
        (uint otherIR, uint otherEA, uint tokenIR, uint tokenEA, ) = _otherTokenIREA(_account, _targetKey);

        tRatio = _targetRatio(_account);

        // get total SA(D) : totalSA = _existDebt / Target Ratio
        uint totalSA = _existDebt.divideDecimal(tRatio);

        // get taltal EA(V) : totalSA = totalSA + exEA - exSA
        totalSA = totalSA.add(tokenEA.add(otherEA)).sub(totalSA.multiplyDecimal(_exStakingRatio(_account, tRatio)));

        // get target token's stakable amount  getExternalTokenQuota() = Tmax
        // X = [ ( Tmax - Tp ) * V - { ( Tt - Tp ) * Vt + ( To - Tp ) * Vo } ] / ( Tt - Tmax )
        // addableAmt = ( Tt - Tp ) * Vt : always Tt > Tp
        addableAmt = _preciseMulToDecimal(tokenIR.sub(getIssuanceRatio()), tokenEA);

        // addableAmt = addableAmt + ( To - Tp ) * Vo : always To > Tp
        addableAmt = addableAmt.add(_preciseMulToDecimal(otherIR.sub(getIssuanceRatio()), otherEA));

        // tempAmt = ( Tmax - Tp ) * V
        uint tempAmt = _preciseMulToDecimal(getExternalTokenQuota().sub(getIssuanceRatio()), totalSA);

        // if target token's EA > target token's SA, return (old exTRatio, 0)
        if (tempAmt < addableAmt) {
            return (0, stakingState.getExTargetRatio(_account), tRatio);
        }

        // addableAmt = ( Tmax - Tp ) * V - addableAmt : always Tmax > Tp
        addableAmt = tempAmt.sub(addableAmt);

        // addableAmt = addableAmt / ( Tt - Tmax )
        addableAmt = _preciseDivToDecimal(addableAmt, tokenIR.sub(getExternalTokenQuota()));

        // round down it upto minimum decimals among staking token list.
        addableAmt = addableAmt.roundDownDecimal(uint(18).sub(stakingState.tokenDecimals(_targetKey)));

        // we need to consider the decimals of the ex-token.
        // get all of _currencyKey token's amount of from the user wallet
        uint tokenPUSDValue = _tokenPUSDValueOf(_account, _targetKey);

        // cap the staking amount within the user's wallet amount
        addableAmt = tokenPUSDValue < addableAmt ? tokenPUSDValue : addableAmt;

        // calc new exSA and save it to tempAmt: exSA = exEA + addableAmt
        tempAmt = tokenEA.add(addableAmt).add(otherEA);

        // get max SA
        uint maxSA = _periCol.add(tempAmt);

        // get total SA
        totalSA = totalSA.add(addableAmt);

        // adjust the changed amount and totalSA if totalSA is over maxSA
        (addableAmt, totalSA) = totalSA > maxSA
            ? (addableAmt > totalSA.sub(maxSA) ? addableAmt.sub(totalSA.sub(maxSA)) : 0, maxSA)
            : (addableAmt, totalSA);

        // get token's staking ratio and save it to exTRatio
        exTRatio = tokenEA.add(addableAmt).divideDecimal(tempAmt);

        // get new exTRatio
        exTRatio = _toTRatio(otherIR, tokenIR, exTRatio);

        // calc new exSR and save it to tRatio
        tRatio = tempAmt.divideDecimal(totalSA);

        // calc new tRatio : tRatio = Tp + ( Te - Tp) * Se
        tRatio = _toTRatio(getIssuanceRatio(), exTRatio, tRatio);
    }

    function _calcMaxStakableAmt(
        uint _tokenIR,
        uint _otherIR,
        uint _tokenEA,
        uint _otherEA,
        uint _totalEA
    ) internal view returns (uint addableAmt) {
        // get target token's stakable amount  getExternalTokenQuota() = Tmax
        // X = [ ( Tmax - Tp ) * V - { ( Tt - Tp ) * Vt + ( To - Tp ) * Vo } ] / ( Tt - Tmax )
        // addableAmt = ( Tt - Tp ) * Vt : always Tt > Tp
        addableAmt = _preciseMulToDecimal(_tokenIR.sub(getIssuanceRatio()), _tokenEA);

        // addableAmt = addableAmt + ( To - Tp ) * Vo : always To > Tp
        addableAmt = addableAmt.add(_preciseMulToDecimal(_otherIR > 0 ? _otherIR.sub(getIssuanceRatio()) : 0, _otherEA));

        // tempAmt = ( Tmax - Tp ) * V : always Tmax > Tp
        uint tempAmt = _preciseMulToDecimal(getExternalTokenQuota().sub(getIssuanceRatio()), _totalEA);

        // if target token's EA > target token's SA, return (old exTRatio, 0)
        if (tempAmt < addableAmt) {
            return 0;
        }

        // addableAmt = ( Tmax - Tp ) * V - addableAmt
        addableAmt = tempAmt.sub(addableAmt);

        // addableAmt = addableAmt / ( Tt - Tmax )
        addableAmt = _preciseDivToDecimal(addableAmt, _tokenIR.sub(getExternalTokenQuota()));
    }

    /**
     * @notice get target token's staking ratio if _addAmt is 0, it retruns current target ratio. if not it returns new target ratio with _addAmt
     *      ( periCol * Tp + stableEA * Ts + paxg * To ) < _existDebt --> lower c-Ratio : burning debt is first thing to do.
     *      both ex-token staking and peri staking need to remove debt first and if there is any extra staking amount, it can be converted to newly added debt.
     *      X = [ ( Tmax - Tp ) * V - { ( Tt - Tp ) * Vt + ( To - Tp ) * Vo } ] / ( Tt - Tmax )
     *      if ex-token staking amount reaches to max, no more ex-token staking is allowed.
     *      if periSA > periCol, any ex-token staking can't compensate peri's over-collateral debt. ex-token staking is only possible to compensate its max addable amount of debt.
     * @param _account staker address
     * @param _existDebt existing debt amount
     * @param _addAmt adding token value amount
     * @param _targetKey external token key
     *
     * @return tRatio target ratio
     * @return addableAmt max stakable amount in USD(exMaxStakableAmt call)
     * @return addDebt adding debt amount in USD
     */
    function _getTRAddDebtOrAmt(
        address _account,
        uint _existDebt,
        uint _addAmt,
        uint _periCol,
        bytes32 _targetKey
    )
        internal
        view
        returns (
            uint tRatio,
            uint addDebt,
            uint addableAmt
        )
    {
        if (_existDebt == 0) {
            return (getIssuanceRatio(), 0, 0);
        }
        // get tokenEA, otherEA, tokenIR, otherIR, exDebt
        (uint otherIR, uint otherEA, uint tokenIR, uint tokenEA, uint exDebt) =
            _otherTokenIREA(_account, _targetKey == bytes32(0) ? USDC : _targetKey);

        // get exEA
        uint exEA = tokenEA.add(otherEA);

        // // get exDebt = tokenEA * tokenIR + otherEA * otherIR
        // uint exDebt = _preciseMulToDecimal(tokenEA, tokenIR).add(
        //     _preciseMulToDecimal(otherEA, otherIR)
        // );

        // get peri debt amount
        uint periDebt = _existDebt > exDebt ? _existDebt.sub(exDebt) : 0;

        // if _addAmt is not 0, the function call while staking ex-token.
        // if _targetKey is not 0, the function call is for getting max ex-stakable amount.
        if (_addAmt != 0 || _targetKey != bytes32(0)) {
            // if max ex-stakable amount call
            if (_addAmt == 0) {
                // calc total SA = exEA + (periDebt / PERI Issuance Ratio)
                addDebt = exEA.add(
                    periDebt > _preciseMulToDecimal(_periCol, getIssuanceRatio())
                        ? _periCol
                        : _preciseDivToDecimal(periDebt, getIssuanceRatio())
                );

                // get addable amount within max ex-issuance ratio
                addableAmt = _calcMaxStakableAmt(tokenIR, otherIR, tokenEA, otherEA, addDebt);

                // get all of _currencyKey token's amount of from the user wallet
                addDebt = _tokenPUSDValueOf(_account, _targetKey);

                // cap the staking amount within the user's wallet amount
                addableAmt = addDebt < addableAmt ? addDebt : addableAmt;

                addDebt = _preciseMulToDecimal(addableAmt, getExTokenIssuanceRatio(_targetKey));

                // if staking ex-token call
            } else {
                // get adding debt(addDebt) and staking amount(_addAmt) in USD
                (addDebt, addableAmt) = (_addAmt, _preciseDivToDecimal(_addAmt, getExTokenIssuanceRatio(_targetKey)));
                addableAmt = addableAmt.roundDownDecimal(uint(18).sub(stakingState.tokenDecimals(_targetKey)));
            }

            // ** check if ex-token staking is able to compensate over-collateral debt
            // if exist periDebt is less than periCol2Debt, which means there is enough PERI in the wallet, set adding debt = addDebt
            // if not and addDebt is more than periDebt - periCol2Debt,
            //  which means PERI value in the wallen doss not cover addDebt + existing debt but covers existing debt,
            //  set adding debt = addDebt - (periDebt - periCol2Debt)
            // otherwise, adding debt = 0
            // get peri-collateral-converted debt : periCol2Debt = periCol * Tp
            _periCol = _preciseMulToDecimal(_periCol, getIssuanceRatio());
            addDebt = periDebt > _periCol
                ? addDebt > periDebt.sub(_periCol) ? addDebt.sub(periDebt.sub(_periCol)) : 0
                : addDebt;

            // ** get updated exEA and ex-debt
            // update tokenEA = tokenEA + addableAmt
            tokenEA = tokenEA.add(addableAmt);
            // update exEA = updated tokenEA + otherEA
            exEA = tokenEA.add(otherEA);

            // update periDebt = tokenEA * tokenIR + otherEA * otherIR
            exDebt = _preciseMulToDecimal(tokenEA, tokenIR).add(_preciseMulToDecimal(otherEA, otherIR));

            // update periDebt = _existDebt + addDebt - exDebt
            _existDebt = _existDebt.add(addDebt);
            periDebt = _existDebt > exDebt ? _existDebt.sub(exDebt) : 0;
        }

        // if no exEA, return getIssuanceRatio(), 0, _preciseDivToDecimal(_existDebt, getIssuanceRatio())
        if (exEA == 0) {
            return (getIssuanceRatio(), addDebt, addableAmt);
        }

        // get peri SA = periDebt / peri issuance ratio
        periDebt = _preciseDivToDecimal(periDebt, getIssuanceRatio());

        // get exTRatio and save it to tRatio (Te = To - (To - Tt) * St)
        tRatio = _toTRatio(otherIR, tokenIR, tokenEA.divideDecimal(exEA));

        // get ex-Staking Ratio and calc TRatio (Tp + ( Te - Tp) * Se)
        tRatio = _toTRatio(getIssuanceRatio(), tRatio, exEA.divideDecimal(exEA.add(periDebt)));
    }

    /**
     * @notice calulate changed external token's staking amount, new target ratios and ex-target ratio
     *
     * @param _account staker address
     * @param _existDebt existing debt amount
     * @param _periCol Peri Collateral amount
     * @param _targetKey external token key
     *
     * @return tRatio target ratio
     * @return exTRatio external token's target ratio
     * @return changedAmt External Changed Staked Aamount(exCSA) in USD
     */
    function _calcTRatio(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    )
        internal
        view
        returns (
            uint tRatio,
            uint exTRatio,
            uint exChangeSA
        )
    {
        // get the staker's Target Ratio
        tRatio = _targetRatio(_account);

        // get the staker's existing staked amount in USD based on existing debt (debt / target ratio)
        uint totalSA = _preciseDivToDecimal(_existDebt, tRatio);

        // get the staker's old external staked amount in USD based on the debt and the external staking ratio
        uint exSA = _preciseMulToDecimal(totalSA, _exStakingRatio(_account, tRatio));

        // get the other token's Issuance Ratio, target token's Issuance Ratio and target token's Staked Amount
        (uint otherIR, uint otherEA, uint tokenIR, uint tokenEA, ) = _otherTokenIREA(_account, _targetKey);

        // get ex-target ratio
        exTRatio = stakingState.getExTargetRatio(_account);

        // get target SR : St = (To-Te) / (To-Tt)
        uint tokenSA = _tokenSR(exTRatio, tokenIR, otherIR);

        // get target token's staked amount in USD based on the debt
        tokenSA = _preciseMulToDecimal(exSA, tokenSA);

        // applying the decimals of the ex-token.
        tokenSA = tokenSA > 0 ? tokenSA.roundDownDecimal(uint(18).sub(stakingState.tokenDecimals(_targetKey))) : 0;

        // calc external staked amount(exEA) and save it to otherEA
        uint exEA = tokenEA.add(otherEA);

        // if there is no newly added debt, return exTRatio
        if (
            tokenEA <= tokenSA /* || exEA <= exSA */
        ) {
            return (tRatio, exTRatio, 0);
        }

        // get Max SA and save it to tokenSA
        uint maxSA = _periCol.add(exEA);

        // get changed amount
        exChangeSA = tokenEA.sub(tokenSA);

        totalSA = totalSA.add(exEA).sub(exSA);

        // (exTRatio, tRatio, exChangeSA) = _calcSAChange(exChangeSA, totalSA, maxSA, tokenEA, exEA, tokenIR, otherIR);

        (exChangeSA, totalSA) = totalSA > maxSA
            ? (exChangeSA > totalSA.sub(maxSA) ? exChangeSA.sub(totalSA.sub(maxSA)) : 0, maxSA)
            : (exChangeSA, totalSA);

        // get token's staking ratio and save it to exTRatio
        exTRatio = tokenEA.divideDecimal(exEA);

        // get new exTRatio
        exTRatio = _toTRatio(otherIR, tokenIR, exTRatio);

        // calc new exSR and save it to tRatio
        tRatio = exEA.divideDecimal(totalSA);

        // calc new tRatio : tRatio = Tp + ( Te - Tp) * Se
        tRatio = _toTRatio(getIssuanceRatio(), exTRatio, tRatio);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function setTargetRatios(
        address _account,
        uint _tRatio,
        uint _exTRatio
    ) external onlyIssuer {
        stakingState.setExTargetRatio(_account, _exTRatio);
        stakingState.setTargetRatio(_account, _tRatio);
    }

    function _saveTRatios(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    ) internal returns (uint changedAmt) {
        // get the staker's expected External token Target Ratio and Target Ratio
        uint tRatio;
        uint exTRatio;
        (tRatio, exTRatio, changedAmt) = _calcTRatio(_account, _existDebt, _periCol, _targetKey);

        // only if it is staking, check the new target ratio is over the max external issuance ratio
        // _requireOverIssuanceRatio(tRatio);

        // set the staker's External token Target Ratio
        stakingState.setExTargetRatio(_account, exTRatio);

        // set the staker's Target Ratio
        stakingState.setTargetRatio(_account, tRatio);
    }

    /**
     * @notice It sets 2 target ratios of the staker.
     *
     * @param _account staker address
     * @param _existDebt existing debt amount
     * @param _amount newly adding debt amount
     * @param _targetKey the external key to be staked
     * @param _stake if true, it is staking, otherwise unstaking
     */
    function _setTargetRatios(
        address _account,
        uint _existDebt,
        uint _amount,
        bytes32 _targetKey,
        bool _stake
    ) internal returns (uint changedAmt) {
        // get the staker's expected External token Target Ratio and Target Ratio
        uint exTRatio;
        uint tRatio;
        (exTRatio, tRatio, changedAmt) = _expectedTargetRatios(_account, _existDebt, _amount, _targetKey, _stake);

        // only if it is staking, check the new target ratio is over the max issuance ratio
        require(!_stake || tRatio <= getExternalTokenQuota(), "over max issuance ratio");

        // set the staker's External token Target Ratio
        stakingState.setExTargetRatio(_account, exTRatio);

        // set the staker's Target Ratio
        stakingState.setTargetRatio(_account, tRatio);
    }

    function stakeToMaxExQuota(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    ) external onlyIssuer returns (uint debtChange) {
        // this function is not to inculde the other token's staked value decrease.
        // (uint exTRatio, uint maxAddableAmt) = _maxStakableAmountOf(_account, _existDebt, _targetKey, _unitKey);
        // this fuction is to include the other token's staked value decrease in order to get the max stakable value.
        // (uint maxAddableAmt, uint exTRatio, uint tRatio) = _maxExStakableAmt(_account, _existDebt, _periCol, _targetKey);
        uint maxAddableAmt;
        uint tRatio;
        (tRatio, debtChange, maxAddableAmt) = _getTRAddDebtOrAmt(_account, _existDebt, 0, _periCol, _targetKey);
        require(maxAddableAmt > 0, "No available ex-tokens to stake");

        // check if the new target ratio is out of allowed external issuance ratio
        _requireOverIssuanceRatio(tRatio);

        // stake the external token
        _stakeTokens(_account, maxAddableAmt, _targetKey, pUSD);

        // debtChange : issuing debt amount
        // debtChange = _preciseMulToDecimal(getExTokenIssuanceRatio(_targetKey), maxAddableAmt);

        // set ex-target ratio
        // stakingState.setExTargetRatio(_account, exTRatio);

        // set target ratio
        // stakingState.setTargetRatio(_account, tRatio);
    }

    function stake(
        address _account,
        uint _amount,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey,
        bytes32 _unitKey
    ) external onlyIssuer returns (uint debtChange) {
        uint tRatio;
        (tRatio, debtChange, _amount) = _getTRAddDebtOrAmt(_account, _existDebt, _amount, _periCol, _targetKey);
        _requireOverIssuanceRatio(tRatio);
        // applying target ratio ( debt to SA ) = (debt / target ratio)
        // changing _amount from requested issuing debt to requested staking amount
        // _amount = _preciseDivToDecimal(_amount, getExTokenIssuanceRatio(_targetKey));

        // set the staker's External token Target Ratio and Target Ratio
        // _amount : requested staking amount
        // debtChange = _setTargetRatios(_account, _existDebt, _amount, _targetKey, true);

        _stakeTokens(_account, _amount, _targetKey, _unitKey);

        // save the staker's Target Ratios
        // debtChange = _saveTRatios(_account, _existDebt, _periCol, _targetKey);

        // debtChange : issuing debt amount
        // debtChange = _preciseMulToDecimal(getExTokenIssuanceRatio(_targetKey), debtChange);
    }

    /**
     * @notice It stakes the external token to the staking contract
     *
     * @param _staker staker address
     * @param _amount adding staking value amount in unit currency
     * @param _targetKey the external key to be staked
     * @param _unitKey the unit currency key
     */
    function _stakeTokens(
        address _staker,
        uint _amount,
        bytes32 _targetKey,
        bytes32 _unitKey
    ) internal {
        // get the staking amount in target currency
        uint stakingAmt = _toCurrency(_unitKey, _targetKey, _amount);

        IERC20 exToken = tokenInstance(_targetKey);

        uint decimals = exToken.decimals();

        require(decimals <= 18, "Invalid decimal number");

        decimals = uint(18).sub(decimals);
        stakingAmt = stakingAmt.roundDownDecimal(decimals);

        // uint balance = exToken.balanceOf(_staker).mul(10**(decimals));

        require(
            exToken.transferFrom(_staker, address(stakingState), stakingAmt.div(10**(decimals))),
            "Transferring staking token has been failed"
        );

        stakingState.stake(_targetKey, _staker, stakingAmt);
    }

    /**
     * @notice unstakes and moves the external token to the staker's wallet.
     *
     * @param _staker the staker address
     * @param _amount unit currency amount
     * @param _targetKey the external key to be unstaked
     * @param _unitKey the unit currency key
     */
    function unstake(
        address _staker,
        uint _amount,
        /* uint _curDebt,
        uint _periCol, */
        bytes32 _targetKey,
        bytes32 _unitKey
    ) external onlyIssuer {
        // changing _amount from requested issuing debt to requested staking amount
        // _amount = _preciseDivToDecimal(_amount, getExTokenIssuanceRatio(_targetKey));
        // _amount = _calcUnstakeAmt(_staker, _amount, _curDebt, _periCol, _targetKey);

        // set the staker's External token Target Ratio and Target Ratio
        // _setTargetRatios(_staker, _existDebt, _amount, _targetKey, false);

        // convert the un-staking amount to one in target currency
        // and unstake the external token
        _unstakeAndRefund(_staker, _staker, _toCurrency(_unitKey, _targetKey, _amount), _targetKey);
    }

    // /**
    //  *
    //  * @param _staker target staker address getting liquidated
    //  * @param _liquidator taker address
    //  * @param _amount unit currency amount getting liquidated
    //  * @param _targetKey the external key to be unstaked
    //  * @param _unitKey the unit currency key
    //  */
    // function unstakeAndLiquidate(
    //     address _staker,
    //     address _liquidator,
    //     uint _amount,
    //     bytes32 _targetKey,
    //     bytes32 _unitKey
    // ) external onlyIssuer {
    //     uint outUnitAmount = _toCurrency(_unitKey, _targetKey, _amount);

    //     _unstakeAndRefund(_staker, _liquidator, outUnitAmount, _targetKey);
    // }

    /**
     * @notice It redeems the external token to move off the debt.
     *
     * @param _account the account address to redeem
     * @param _amount total amount to move off the debt
     *
     * @param _liquidator the liquidator address
     */
    function redeem(
        address _account,
        uint _amount,
        /* uint _existDebt, */
        address _liquidator
    ) external onlyLiquidations returns (uint remainAmt) {
        // get ex-staked amount in unit currency
        uint exEA = _combinedStakedAmountOf(_account, pUSD);

        (_amount, remainAmt) = _amount > exEA ? (exEA, _amount.sub(exEA)) : (_amount, 0);

        remainAmt = remainAmt.add(_proRataUnstake(_account, _liquidator, _amount, exEA, pUSD));
        // _initTargetRatios(_account, _existDebt.sub(_amount));
        /* remainAmount = amount;
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();

        for (uint i; i < tokenList.length; i++) {
            if (tokenList[i] == PERI) {
                continue;
            }

            if (remainAmount == 0) {
                break;
            }

            // staked token amount
            uint stakedAmt = _stakedAmountOf(account, tokenList[i], tokenList[i]);

            // if there is staked amount left
            if (stakedAmt > 0) {
                // convert th token amount to pUSD amount
                uint usdAmount = _toCurrency(tokenList[i], pUSD, stakedAmt);

                // staked pUSD value is bgger than remainAmount(getting liquidated pUSD value)
                if (remainAmount < usdAmount) {
                    // replace usdAmount to remainAmount
                    usdAmount = remainAmount;
                    // convert the pUSD amount to the token amount
                    stakedAmt = _toCurrency(pUSD, tokenList[i], usdAmount);
                }

                //uint unstakingAmountConverted = _toCurrency(tokenList[i], pUSD, redeemed);
                //_unstakeAndRefund(account, liquidator, unstakingAmountConverted, tokenList[i]);

                // unstake staked tokens and reward the liquidator
                _unstakeAndRefund(account, liquidator, stakedAmt, tokenList[i]);
                // subtract to-be-moved-off-debt amount by already moved off debt amount
                remainAmount = remainAmount.sub(usdAmount);
            }
        } */
    }

    /* 
    function _proRataRefundAmt(address _staker, uint _amount, uint exEA, bytes32 _unitKey) 
        internal view returns(uint remainAmount) {

        // uint totUnstake = _amount > exEA ? exEA : _amount;

        uint stakedAmt; uint unstakAmt; uint decimals; uint tokenSR;
        // set the currency key order if currencyKeyOrder is not set
        bytes32[] memory keys = stakingState.getTokenCurrencyKeys();
        for (uint i; i < keys.length; i++) {
            // get the staked amount of the token
            stakedAmt = _stakedAmountOf(_staker, keys[i], _unitKey);

            // if the amount to be unstaked is 0, move to the next token
            if (stakedAmt == 0) {
                continue;
            }

            // get the token's staking ratio against ex-staked amount
            tokenSR = stakedAmt.divideDecimal(exEA);
            // get unstake amount
            unstakAmt = _preciseMulToDecimal(_amount, tokenSR).add(remainAmount);
            // get remain amount and cap unstakAmt within stakedAmt
            (remainAmount, unstakAmt) = unstakAmt > stakedAmt 
                ? (unstakAmt.sub(stakedAmt), stakedAmt) 
                : (0, unstakAmt);
            // convert the unstake amount to the token amount
            unstakAmt = _toCurrency(_unitKey, keys[i], unstakAmt);
            // get the token's decimals
            decimals = stakingState.tokenDecimals(keys[i]);
            if (uint(18) > decimals) {
                tokenSR = unstakAmt;
                unstakAmt = unstakAmt.roundDownDecimal(uint(18).sub(decimals));

                // update remainAmount
                tokenSR = tokenSR.sub(unstakAmt);
                tokenSR = _toCurrency(keys[i], _unitKey, tokenSR);
                remainAmount = remainAmount.add(tokenSR);

            }
        }
    }
 */
    /**
     * @notice It unstakes multiple tokens by pre-defined order.
     * @dev internal function
     * @param _staker staker address
     * @param _taker taker address
     * @param _amount amount to get unstaked in unit currency
     * @param _unitKey the currency unit of _amount
     *
     */
    function _proRataUnstake(
        address _staker,
        address _taker,
        uint _amount,
        uint exEA,
        bytes32 _unitKey
    ) internal returns (uint remainAmount) {
        // uint totUnstake = _amount > exEA ? exEA : _amount;

        uint stakedAmt;
        uint unstakAmt;
        uint decimals;
        uint tokenSR;
        uint minDecimals = 16;
        // set the currency key order if currencyKeyOrder is not set
        bytes32[] memory keys = stakingState.getTokenCurrencyKeys();
        for (uint i; i < keys.length; i++) {
            // get the staked amount of the token
            stakedAmt = _stakedAmountOf(_staker, keys[i], _unitKey);

            // if the amount to be unstaked is 0, move to the next token
            if (stakedAmt == 0) {
                continue;
            }

            // get the token's staking ratio against ex-staked amount
            tokenSR = stakedAmt.divideDecimal(exEA);
            // get unstake amount
            unstakAmt = _preciseMulToDecimal(_amount, tokenSR);
            unstakAmt = unstakAmt.add(remainAmount);
            // get remain amount and cap unstakAmt within stakedAmt
            (remainAmount, unstakAmt) = unstakAmt > stakedAmt ? (unstakAmt.sub(stakedAmt), stakedAmt) : (0, unstakAmt);
            // convert the unstake amount to the token amount
            unstakAmt = _toCurrency(_unitKey, keys[i], unstakAmt);
            // get the token's decimals
            decimals = stakingState.tokenDecimals(keys[i]);
            if (uint(18) > decimals) {
                // save unstakAmt to tokenSR
                tokenSR = unstakAmt;
                // round down the unstake amount
                unstakAmt = unstakAmt.roundDownDecimal(uint(18).sub(decimals));

                // update remainAmount
                tokenSR = tokenSR.sub(unstakAmt);
                tokenSR = _toCurrency(keys[i], _unitKey, tokenSR);
                remainAmount = remainAmount.add(tokenSR);
                minDecimals = minDecimals > decimals ? decimals : minDecimals;
            }

            // unstake the token and refund it to the staker/liquidator
            _unstakeAndRefund(_staker, _taker, unstakAmt, keys[i]);
        }

        remainAmount = minDecimals < 18 && remainAmount > 10**(18 - minDecimals) ? remainAmount : 0;
    }

    /**
     * @notice It unstakes multiple tokens by pre-defined order.
     *
     * @param _staker staker address
     * @param _existDebt existing debt amount
     * @param _periCol Peri Collateral amount
     */
    function unstakeToFitTR(
        address _staker,
        uint _existDebt,
        uint _periCol
    ) external onlyIssuer returns (uint burnAmt) {
        // bytes32[] memory currencyKeys = stakingState.getTokenCurrencyKeys();

        // get the order of unstaking
        // bytes32[] memory order;
        // if (!_keyChecker(currencyKeys, currencyKeyOrder)) {
        //     order = currencyKeys;
        // } else {
        //     order = currencyKeyOrder;
        // }

        /*  
        // set the currency key order if currencyKeyOrder is not set
        bytes32[] memory order = stakingState.getTokenCurrencyKeys();
        if (_keyChecker(order, currencyKeyOrder)) {
            order = currencyKeyOrder;
        }

        // get the staker's total staked amount in unit currency
        uint combinedAmount = _combinedStakedAmountOf(_staker, _unitKey);
        require(_combinedStakedAmountOf(_staker, _unitKey) >= _amount, "Combined staked amount is not enough");

        uint[] memory unsakingAmts = new uint[](order.length);
        for (uint i = 0; i < order.length; i++) {
            // get the staked amount of the token
            uint stakedAmt = stakingState.stakedAmountOf(order[i], _staker);

            // Becacuse of exchange rate calculation error,
            // remained unstaking debt amount is converted into each currency rather than converting staked amount.
            uint unstakingAmt = _toCurrency(_unitKey, order[i], _amount);
            // If the token amount is smaller than amount to be unstaked, 
            if (stakedAmt < unstakingAmt) {
                // set the token amount to the amount to be unstaked.
                unsakingAmts[i] = stakedAmt;

                // subtract the amount to be unstaked by the token amount
                // convert remained unstaking amount into unit currency and set it to _amount
                _amount = _toCurrency(order[i], _unitKey, unstakingAmt.sub(stakedAmt));
            } else {
                unsakingAmts[i] = unstakingAmt;

                _amount = 0;
            }

            // unstake the token and refund it to the staker
            _unstakeAndRefund(_staker, _staker, (_amount > 0 ? stakedAmt : unstakingAmt), order[i]);

            // if the amount to be unstaked is 0, break the loop
            if (_amount == 0) {
                break;
            }
        }*/

        uint exRefundAmt;
        uint exEA;
        (burnAmt, exRefundAmt, exEA) = _burnAmtToFitTR(_staker, _existDebt, _periCol);

        require(burnAmt != 0 || exRefundAmt != 0, "Account is already claimable");

        if (exRefundAmt != 0) {
            _proRataUnstake(_staker, _staker, exRefundAmt, exEA, pUSD);
        }

        // _initTargetRatios(_staker, _existDebt.sub(_amount).add(remainAmt));

        // for (uint i = 0; i < order.length; i++) {
        //     if (unsakingAmts[i] == 0) {
        //         continue;
        //     }

        //     _unstakeAndRefund(_staker, _staker, unsakingAmts[i], order[i]);
        // }
    }

    /**
     * @notice unstakes tokens and refund it to the staker or liquidator.
     *
     * @param _unstaker staker address
     * @param _liquidator liquidator or staker address
     * @param _amount amount to get unstaked in unit currency
     * @param _targetKey the currency unit of _amount
     *
     */
    function _unstakeAndRefund(
        address _unstaker,
        address _liquidator,
        uint _amount,
        bytes32 _targetKey
    ) internal tokenRegistered(_targetKey) {
        uint targetDecimals = stakingState.tokenDecimals(_targetKey);
        require(targetDecimals <= 18, "Invalid decimal number");

        // We don't have to round up for staking or unstaking amount.
        // uint unstakingAmountConvertedRoundedUp = _amount.roundUpDecimal(uint(18).sub(targetDecimals));
        uint floorUnstakingAmount = _amount.roundDownDecimal(uint(18).sub(targetDecimals));

        // stakingState.unstake(_targetKey, _unstaker, unstakingAmountConvertedRoundedUp);
        stakingState.unstake(_targetKey, _unstaker, floorUnstakingAmount);

        require(
            // stakingState.refund(_targetKey, _liquidator, unstakingAmountConvertedRoundedUp),
            stakingState.refund(_targetKey, _liquidator, floorUnstakingAmount),
            "Refund has been failed"
        );
    }

    /**
     * @notice Sets stakingState contract address
     *
     * @param _stakingState stakingState contract address
     */
    function setStakingState(address _stakingState) external onlyOwner {
        stakingState = IStakingState(_stakingState);
    }

    /**
     * @notice unstakes all tokens and refund it to the staker.
     *
     * @param _from address of staker
     */
    function exit(address _from) external onlyIssuer {
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();
        for (uint i; i < tokenList.length; i++) {
            uint stakedAmount = _stakedAmountOf(_from, tokenList[i], tokenList[i]);

            if (stakedAmount == 0) {
                continue;
            }

            _unstakeAndRefund(_from, _from, stakedAmount, tokenList[i]);
        }
        // stakingState.setTargetRatio(_from, getIssuanceRatio());
        // stakingState.setExTargetRatio(_from, 0);
    }

    function _requireOverIssuanceRatio(uint _tRatio) internal view {
        require(_tRatio.roundDownDecimal(uint(12)) <= getExternalTokenQuota(), "Over max external quota");
    }

    function _requireRatesNotInvalid(bool anyRateIsInvalid) internal pure {
        require(!anyRateIsInvalid, "A pynth or PERI rate is invalid");
    }

    function _onlyIssuer() internal view {
        require(msg.sender == address(issuer()), "Sender is not Issuer");
    }

    function _onlyLiquidations() internal view {
        require(msg.sender == address(liquidations()), "Sender is not Liquidations");
    }

    function _tokenRegistered(bytes32 _currencyKey) internal view {
        require(stakingState.tokenAddress(_currencyKey) != address(0), "Target token is not registered");
    }

    modifier onlyIssuer() {
        _onlyIssuer();
        _;
    }

    modifier onlyLiquidations() {
        _onlyLiquidations();
        _;
    }

    modifier tokenRegistered(bytes32 _currencyKey) {
        _tokenRegistered(_currencyKey);
        _;
    }
}
