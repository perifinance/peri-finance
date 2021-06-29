pragma solidity ^0.5.16;

import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./LimitedSetup.sol";

import "./SafeDecimalMath.sol";

import "./interfaces/IStakingState.sol";
import "./interfaces/IIssuer.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IStakingStateUSDC.sol";

contract ExternalTokenStakeManager is Owned, MixinResolver, MixinSystemSettings, LimitedSetup(8 weeks) {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    IStakingState public stakingState;
    IStakingStateUSDC public stakingStateUSDC; // this one for migration from old state

    bytes32 internal constant pUSD = "pUSD";
    bytes32 internal constant PERI = "PERI";
    bytes32 internal constant USDC = "USDC";

    bytes32 public constant CONTRACT_NAME = "ExternalTokenStakeManager";

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";

    constructor(
        address _owner,
        address _stakingState,
        address _stakingStateUSDC,
        address _resolver
    ) public Owned(_owner) MixinSystemSettings(_resolver) {
        stakingState = IStakingState(_stakingState);
        stakingStateUSDC = IStakingStateUSDC(_stakingStateUSDC);
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

    function totalStakedAmountOf(address _user, bytes32 _unitCurrency) external view returns (uint) {
        return _totalStakedAmountOf(_user, _unitCurrency);
    }

    function stakedAmountOf(
        address _user,
        bytes32 _currencyKey,
        bytes32 _unitCurrency
    ) external view returns (uint) {
        if (_currencyKey == _unitCurrency) {
            return stakingState.stakedAmountOf(_currencyKey, _user);
        } else {
            return _toCurrency(_currencyKey, _unitCurrency, stakingState.stakedAmountOf(_currencyKey, _user));
        }
    }

    function _totalStakedAmountOf(address _user, bytes32 _unitCurrency) internal view returns (uint totalStakedAmount) {
        bytes32[] memory tokenList = stakingState.getTokenCurrencyKeys();

        uint[] memory stakedAmountOf = new uint[](tokenList.length);

        for (uint i = 0; i < tokenList.length; i++) {
            uint _stakedAmount = stakingState.stakedAmountOf(tokenList[i], _user);

            if (_stakedAmount == 0) {
                continue;
            }

            stakedAmountOf[i] = _toCurrency(tokenList[i], _unitCurrency, _stakedAmount);

            totalStakedAmount.add(stakedAmountOf[i]);
        }
    }

    function _toCurrency(
        bytes32 _currencyKey,
        bytes32 _toCurrencyKey,
        uint _amount
    ) internal view returns (uint) {
        (uint toUSDRate, bool usdRateIsInvalid) = exchangeRates().rateAndInvalid(_currencyKey);

        _requireRatesNotInvalid(usdRateIsInvalid);

        uint amountToUSD = _amount.multiplyDecimalRound(toUSDRate);

        if (_toCurrencyKey == pUSD) {
            return amountToUSD;
        } else {
            (uint toCurrencyRate, bool toCurrencyRateIsInvalid) = exchangeRates().rateAndInvalid(_toCurrencyKey);

            _requireRatesNotInvalid(toCurrencyRateIsInvalid);

            return amountToUSD.divideDecimalRound(toCurrencyRate);
        }
    }

    function migrateStakedAmounts(address[] calldata _accounts) external onlyDuringSetup onlyOwner {
        for (uint i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];

            uint staked = stakingStateUSDC.stakedAmountOf(account);

            if (staked == 0) {
                continue;
            }

            stakingStateUSDC.unstake(account, staked);
            stakingState.stake(USDC, account, staked);
        }
    }

    function _requireRatesNotInvalid(bool anyRateIsInvalid) internal pure {
        require(!anyRateIsInvalid, "A pynth or PERI rate is invalid");
    }

    function _onlyIssuer() internal view {
        require(msg.sender == address(issuer()), "Sender is not Issuer");
    }

    function _tokenRegistered(bytes32 _currencyKey) internal view {
        require(stakingState.tokenAddress(_currencyKey) != address(0), "Token is not registered");
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
