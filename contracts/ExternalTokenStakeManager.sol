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

    // This key order is used from unstaking multiple coins
    bytes32[] public currencyKeyOrder;

    constructor(
        address _owner,
        address _stakingState,
        address _resolver
    ) public Owned(_owner) MixinSystemSettings(_resolver) {
        stakingState = IStakingState(_stakingState);
    }

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](2);

        newAddresses[0] = CONTRACT_ISSUER;
        newAddresses[1] = CONTRACT_EXRATES;

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

    function getCurrencyKeyOrder() external view returns (bytes32[] memory) {
        return currencyKeyOrder;
    }

    function combinedStakedAmountOf(address _user, bytes32 _unitCurrency) external view returns (uint) {
        return _combinedStakedAmountOf(_user, _unitCurrency);
    }

    function compiledStakableAmountOf(address _user, bytes32 _unitCurrency) external view returns (uint) {
        return _compiledStakableAmountOf(_user, _unitCurrency);
    }

    function getTokenPUSDValueOf(address _user, bytes32 _currencyKey) external view returns (uint) {
        return _tokenPUSDValueOf(_user, _currencyKey);
    }

    function _tokenPUSDValueOf(address _user, bytes32 _currencyKey) internal view returns (uint) {
        (uint tokenRate, bool rateIsInvalid) = exchangeRates().rateAndInvalid(_currencyKey);

        _requireRatesNotInvalid(rateIsInvalid);

        IERC20 exToken = tokenInstance(_currencyKey);

        uint balance = exToken.balanceOf(_user).mul(10**(uint(18).sub(exToken.decimals())));

        return balance.multiplyDecimal(tokenRate);
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
    ) internal view returns (uint) {
        if (_currencyKey == _unitCurrency) {
            return stakingState.stakedAmountOf(_currencyKey, _user);
        } else {
            return _toCurrency(_currencyKey, _unitCurrency, stakingState.stakedAmountOf(_currencyKey, _user));
        }
    }

    function requireNotExceedsQuotaLimit(
        address _account,
        uint _debtBalance,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) external view {
        uint estimatedExternalTokenQuota =
            _externalTokenQuota(_account, _debtBalance, _additionalpUSD, _additionalExToken, _isIssue);

        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();
        uint minDecimals = 18;
        for (uint i = 0; i < tokenList.length; i++) {
            uint decimals = stakingState.tokenDecimals(tokenList[i]);

            minDecimals = decimals < minDecimals ? decimals : minDecimals;
        }

        require(
            // due to the error caused by decimal difference, round down it upto minimum decimals among staking token list.
            estimatedExternalTokenQuota.roundDownDecimal(uint(18).sub(minDecimals)) <= getExternalTokenQuota(),
            "External token staking amount exceeds quota limit"
        );
    }

    function externalTokenQuota(
        address _account,
        uint _debtBalance,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) external view returns (uint) {
        return _externalTokenQuota(_account, _debtBalance, _additionalpUSD, _additionalExToken, _isIssue);
    }

    /**
     * @notice It calculates the quota of user's staked amount to the debt.
     *         If parameters are not 0, it estimates the quota assuming those value is applied to current status.
     *
     * @param _account account
     * @param _debtBalance Debt balance to estimate [USD]
     * @param _additionalpUSD The pUSD value to be applied for estimation [USD]
     * @param _additionalExToken The external token stake amount to be applied for estimation [USD]
     * @param _isIssue If true, it is considered issueing/staking estimation.
     */
    function _externalTokenQuota(
        address _account,
        uint _debtBalance,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) internal view returns (uint) {
        uint combinedStakedAmount = _combinedStakedAmountOf(_account, pUSD);

        if (_debtBalance == 0 || combinedStakedAmount == 0) {
            return 0;
        }

        if (_isIssue) {
            _debtBalance = _debtBalance.add(_additionalpUSD);
            combinedStakedAmount = combinedStakedAmount.add(_additionalExToken);
        } else {
            _debtBalance = _debtBalance.sub(_additionalpUSD);
            combinedStakedAmount = combinedStakedAmount.sub(_additionalExToken);
        }

        return combinedStakedAmount.divideDecimalRound(_debtBalance.divideDecimalRound(getIssuanceRatio()));
    }

    function _combinedStakedAmountOf(address _user, bytes32 _unitCurrency)
        internal
        view
        returns (uint combinedStakedAmount)
    {
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();

        for (uint i = 0; i < tokenList.length; i++) {
            uint _stakedAmount = stakingState.stakedAmountOf(tokenList[i], _user);

            if (_stakedAmount == 0) {
                continue;
            }

            uint stakedAmount = _toCurrency(tokenList[i], _unitCurrency, _stakedAmount);

            combinedStakedAmount = combinedStakedAmount.add(stakedAmount);
        }
    }

    /**
     * @notice for calculating stakable amount of the external tokens in the staker's wallet.
     */
    function _compiledStakableAmountOf(address _user, bytes32 _unitCurrency)
        internal
        view
        returns (uint compiledStakableAmount)
    {
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();

        for (uint i = 0; i < tokenList.length; i++) {
            uint _stakedAmount = stakingState.stakedAmountOf(tokenList[i], _user);

            uint _stakableAmount =
                tokenInstance(tokenList[i]).balanceOf(_user).mul(10**(18 - (uint)(tokenInstance(tokenList[i]).decimals()))) -
                    _stakedAmount;

            uint stakableAmount = _toCurrency(tokenList[i], _unitCurrency, _stakableAmount);

            compiledStakableAmount = compiledStakableAmount.add(stakableAmount);
        }
    }

    function _toCurrency(
        bytes32 _fromCurrencyKey,
        bytes32 _toCurrencyKey,
        uint _amount
    ) internal view returns (uint) {
        if (_fromCurrencyKey == _toCurrencyKey) {
            return _amount;
        }

        uint amountToUSD;
        if (_fromCurrencyKey == pUSD) {
            amountToUSD = _amount;
        } else {
            (uint toUSDRate, bool fromCurrencyRateIsInvalid) = exchangeRates().rateAndInvalid(_fromCurrencyKey);

            _requireRatesNotInvalid(fromCurrencyRateIsInvalid);

            amountToUSD = _amount.multiplyDecimalRound(toUSDRate);
        }

        if (_toCurrencyKey == pUSD) {
            return amountToUSD;
        } else {
            (uint toCurrencyRate, bool toCurrencyRateIsInvalid) = exchangeRates().rateAndInvalid(_toCurrencyKey);

            _requireRatesNotInvalid(toCurrencyRateIsInvalid);

            return amountToUSD.divideDecimalRound(toCurrencyRate);
        }
    }

    /**
     * @notice Utils checking given two key arrays' value are matching each other(its order will not be considered).
     */
    function _keyChecker(bytes32[] memory _keysA, bytes32[] memory _keysB) internal pure returns (bool) {
        if (_keysA.length != _keysB.length) {
            return false;
        }

        for (uint i = 0; i < _keysA.length; i++) {
            bool exist;
            for (uint j = 0; j < _keysA.length; j++) {
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

    function stake(
        address _staker,
        uint _amount,
        bytes32 _targetCurrency,
        bytes32 _inputCurrency
    ) external onlyIssuer {
        uint stakingAmountConverted = _toCurrency(_inputCurrency, _targetCurrency, _amount);

        uint targetDecimals = stakingState.tokenDecimals(_targetCurrency);

        require(targetDecimals <= 18, "Invalid decimal number");
        uint stakingAmountConvertedRoundedUp = stakingAmountConverted.roundUpDecimal(uint(18).sub(targetDecimals));

        require(
            tokenInstance(_targetCurrency).transferFrom(
                _staker,
                address(stakingState),
                stakingAmountConvertedRoundedUp.div(10**(uint(18).sub(targetDecimals)))
                // stakingAmountConverted.div(10**(uint(18).sub(targetDecimals)))
            ),
            "Transferring staking token has been failed"
        );

        stakingState.stake(_targetCurrency, _staker, stakingAmountConvertedRoundedUp);
        // stakingState.stake(_targetCurrency, _staker, stakingAmountConverted);
    }

    function unstake(
        address _unstaker,
        uint _amount,
        bytes32 _targetCurrency,
        bytes32 _inputCurrency
    ) external onlyIssuer {
        uint unstakingAmountConverted = _toCurrency(_inputCurrency, _targetCurrency, _amount);

        _unstakeAndRefund(_unstaker, _unstaker, unstakingAmountConverted, _targetCurrency);
    }

    function unstakeAndLiquidate(
        address _unstaker,
        address _liquidator,
        uint _amount,
        bytes32 _targetCurrency,
        bytes32 _inputCurrency
    ) external onlyIssuer {
        uint unstakingAmountConverted = _toCurrency(_inputCurrency, _targetCurrency, _amount);

        _unstakeAndRefund(_unstaker, _liquidator, unstakingAmountConverted, _targetCurrency);
    }

    function redeem(
        address account,
        uint totalRedeemed,
        address liquidator
    ) external onlyIssuer returns (uint) {
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();

        for (uint i = 0; i < tokenList.length; i++) {
            if (tokenList[i] == PERI) {
                continue;
            }

            if (totalRedeemed == 0) {
                break;
            }

            // token staking amount
            uint stakingAmount = _stakedAmountOf(account, tokenList[i], tokenList[i]);

            // staking 되어있으면.
            if (stakingAmount > 0) {
                // stake된 token을 pUSD로 환산
                uint usdAmount = _toCurrency(tokenList[i], pUSD, stakingAmount);

                // 청산 금액보다 staking된 값이 크면
                if (totalRedeemed < usdAmount) {
                    // pUSD 환산 staking 금액을 totalRedeemed로 변경
                    usdAmount = totalRedeemed;
                    // pUSD 환산 staking 금액을 token 단위로 변경
                    stakingAmount = _toCurrency(pUSD, tokenList[i], usdAmount);
                }

                //uint unstakingAmountConverted = _toCurrency(tokenList[i], pUSD, redeemed);
                //_unstakeAndRefund(account, liquidator, unstakingAmountConverted, tokenList[i]);
                _unstakeAndRefund(account, liquidator, stakingAmount, tokenList[i]);
                totalRedeemed = totalRedeemed.sub(usdAmount);
            }
        }

        return totalRedeemed;
    }

    /**
     * @notice It unstakes multiple tokens by pre-defined order.
     *
     * @param _unstaker unstaker address
     * @param _amount amount to unstake
     * @param _inputCurrency the currency unit of _amount
     *
     * @dev bytes32 variable "order" is only able to be assigned by setUnstakingOrder(),
     *      and it checks its conditions there, here won't check its validation.
     */
    function unstakeMultipleTokens(
        address _unstaker,
        uint _amount,
        bytes32 _inputCurrency
    ) external onlyIssuer {
        bytes32[] memory currencyKeys = stakingState.getTokenCurrencyKeys();

        bytes32[] memory order;
        if (!_keyChecker(currencyKeys, currencyKeyOrder)) {
            order = currencyKeys;
        } else {
            order = currencyKeyOrder;
        }

        uint combinedStakedAmount = _combinedStakedAmountOf(_unstaker, _inputCurrency);
        require(combinedStakedAmount >= _amount, "Combined staked amount is not enough");

        uint[] memory unstakeAmountByCurrency = new uint[](order.length);
        for (uint i = 0; i < order.length; i++) {
            uint stakedAmountByCurrency = stakingState.stakedAmountOf(order[i], _unstaker);

            // Becacuse of exchange rate calculation error,
            // input amount is converted into each currency key rather than converting staked amount.
            uint amountConverted = _toCurrency(_inputCurrency, order[i], _amount);
            if (stakedAmountByCurrency < amountConverted) {
                // If staked amount is lower than amount to unstake, all staked amount will be unstaked.
                unstakeAmountByCurrency[i] = stakedAmountByCurrency;
                amountConverted = amountConverted.sub(stakedAmountByCurrency);
                _amount = _toCurrency(order[i], _inputCurrency, amountConverted);
            } else {
                unstakeAmountByCurrency[i] = amountConverted;
                _amount = 0;
            }

            if (_amount == 0) {
                break;
            }
        }

        for (uint i = 0; i < order.length; i++) {
            if (unstakeAmountByCurrency[i] == 0) {
                continue;
            }

            _unstakeAndRefund(_unstaker, _unstaker, unstakeAmountByCurrency[i], order[i]);
        }
    }

    function _unstakeAndRefund(
        address _unstaker,
        address _liquidator,
        uint _amount,
        bytes32 _targetCurrency
    ) internal tokenRegistered(_targetCurrency) {
        uint targetDecimals = stakingState.tokenDecimals(_targetCurrency);
        require(targetDecimals <= 18, "Invalid decimal number");

        // We don't have to round up for staking or unstaking amount.
        // uint unstakingAmountConvertedRoundedUp = _amount.roundUpDecimal(uint(18).sub(targetDecimals));
        uint unstakingAmountConvertedRoundedDown = _amount.roundDownDecimal(uint(18).sub(targetDecimals));

        // stakingState.unstake(_targetCurrency, _unstaker, unstakingAmountConvertedRoundedUp);
        stakingState.unstake(_targetCurrency, _unstaker, unstakingAmountConvertedRoundedDown);

        require(
            // stakingState.refund(_targetCurrency, _liquidator, unstakingAmountConvertedRoundedUp),
            stakingState.refund(_targetCurrency, _liquidator, unstakingAmountConvertedRoundedDown),
            "Refund has been failed"
        );
    }

    function setUnstakingOrder(bytes32[] calldata _order) external onlyOwner {
        bytes32[] memory currencyKeys = stakingState.getTokenCurrencyKeys();

        require(_keyChecker(currencyKeys, _order), "Given currency keys are not available");

        currencyKeyOrder = _order;
    }

    function setStakingState(address _stakingState) external onlyOwner {
        stakingState = IStakingState(_stakingState);
    }

    function exit(address _from) external onlyIssuer {
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();
        for (uint i; i < tokenList.length; i++) {
            uint stakedAmount = _stakedAmountOf(_from, tokenList[i], tokenList[i]);

            if (stakedAmount == 0) {
                continue;
            }

            _unstakeAndRefund(_from, _from, stakedAmount, tokenList[i]);
        }
    }

    function _requireRatesNotInvalid(bool anyRateIsInvalid) internal pure {
        require(!anyRateIsInvalid, "A pynth or PERI rate is invalid");
    }

    function _onlyIssuer() internal view {
        require(msg.sender == address(issuer()), "Sender is not Issuer");
    }

    function _tokenRegistered(bytes32 _currencyKey) internal view {
        require(stakingState.tokenAddress(_currencyKey) != address(0), "Target token is not registered");
    }

    modifier onlyIssuer() {
        _onlyIssuer();
        _;
    }

    modifier tokenRegistered(bytes32 _currencyKey) {
        _tokenRegistered(_currencyKey);
        _;
    }
}
