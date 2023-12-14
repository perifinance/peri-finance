pragma solidity 0.5.16;

// Inheritance
import "./interfaces/IPynth.sol";
// import "./interfaces/IPeriFinance.sol";
import "./interfaces/IExchangeRates.sol";
import "./interfaces/IAddressResolver.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IIssuer.sol";

// https://docs.peri.finance/contracts/source/contracts/pynthutil
contract PynthUtil {
    IAddressResolver public addressResolverProxy;

    // bytes32 internal constant CONTRACT_PERIFINANCE = "PeriFinance";
    bytes32 internal constant CONTRACT_EXRATES = "ExchangeRates";
    bytes32 internal constant CONTRACT_ISSUER = "Issuer";
    bytes32 internal constant PUSD = "pUSD";

    constructor(address resolver) public {
        addressResolverProxy = IAddressResolver(resolver);
    }

    // function _periFinance() internal view returns (IPeriFinance) {
    //     return IPeriFinance(addressResolverProxy.requireAndGetAddress(CONTRACT_PERIFINANCE, "Missing PeriFinance address"));
    // }

    function _exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(addressResolverProxy.requireAndGetAddress(CONTRACT_EXRATES, "Missing ExchangeRates address"));
    }

    function _issuer() internal view returns (IIssuer) {
        return IIssuer(addressResolverProxy.requireAndGetAddress(CONTRACT_ISSUER, "Missing Issuer address"));
    }

    function totalPynthsInKey(address account, bytes32 currencyKey) external view returns (uint total) {
        IIssuer issuer = _issuer();
        IExchangeRates exchangeRates = _exchangeRates();
        uint numPynths = issuer.availablePynthCount();
        for (uint i; i < numPynths; i++) {
            IPynth pynth = issuer.availablePynths(i);
            total += exchangeRates.effectiveValue(
                pynth.currencyKey(),
                IERC20(address(pynth)).balanceOf(account),
                currencyKey
            );
        }
        return total;
    }

    function pynthsBalances(address account)
        external
        view
        returns (
            bytes32[] memory,
            uint[] memory,
            uint[] memory
        )
    {
        IIssuer issuer = _issuer();
        IExchangeRates exchangeRates = _exchangeRates();
        uint numPynths = issuer.availablePynthCount();
        bytes32[] memory currencyKeys = new bytes32[](numPynths);
        uint[] memory balances = new uint[](numPynths);
        uint[] memory pUSDBalances = new uint[](numPynths);
        for (uint i; i < numPynths; i++) {
            IPynth pynth = issuer.availablePynths(i);
            currencyKeys[i] = pynth.currencyKey();
            balances[i] = IERC20(address(pynth)).balanceOf(account);
            pUSDBalances[i] = exchangeRates.effectiveValue(currencyKeys[i], balances[i], PUSD);
        }
        return (currencyKeys, balances, pUSDBalances);
    }

    function frozenPynths() external view returns (bytes32[] memory) {
        IIssuer issuer = _issuer();
        IExchangeRates exchangeRates = _exchangeRates();
        uint numPynths = issuer.availablePynthCount();
        bytes32[] memory frozenPynthsKeys = new bytes32[](numPynths);
        for (uint i; i < numPynths; i++) {
            IPynth pynth = issuer.availablePynths(i);
            if (exchangeRates.rateIsFrozen(pynth.currencyKey())) {
                frozenPynthsKeys[i] = pynth.currencyKey();
            }
        }
        return frozenPynthsKeys;
    }

    function pynthsRates() external view returns (bytes32[] memory, uint[] memory) {
        bytes32[] memory currencyKeys = _issuer().availableCurrencyKeys();
        return (currencyKeys, _exchangeRates().ratesForCurrencies(currencyKeys));
    }

    function pynthsTotalSupplies()
        external
        view
        returns (
            bytes32[] memory,
            uint256[] memory,
            uint256[] memory
        )
    {
        IIssuer issuer = _issuer();
        IExchangeRates exchangeRates = _exchangeRates();

        uint256 numPynths = issuer.availablePynthCount();
        bytes32[] memory currencyKeys = new bytes32[](numPynths);
        uint256[] memory balances = new uint256[](numPynths);
        uint256[] memory pUSDBalances = new uint256[](numPynths);
        for (uint256 i; i < numPynths; i++) {
            IPynth pynth = issuer.availablePynths(i);
            currencyKeys[i] = pynth.currencyKey();
            balances[i] = IERC20(address(pynth)).totalSupply();
            pUSDBalances[i] = exchangeRates.effectiveValue(currencyKeys[i], balances[i], PUSD);
        }
        return (currencyKeys, balances, pUSDBalances);
    }
}
