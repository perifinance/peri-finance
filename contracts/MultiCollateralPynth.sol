pragma solidity ^0.5.16;

// Inheritance
import "./Pynth.sol";

// Internal references
import "./interfaces/ICollateralManager.sol";
import "./interfaces/IEtherCollateralpUSD.sol";
import "./interfaces/IEtherCollateral.sol";

// https://docs.peri.finance/contracts/source/contracts/multicollateralpynth
contract MultiCollateralPynth is Pynth {
    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 private constant CONTRACT_COLLATERALMANAGER = "CollateralManager";
    bytes32 private constant CONTRACT_ETH_COLLATERAL = "EtherCollateral";
    bytes32 private constant CONTRACT_ETH_COLLATERAL_PUSD = "EtherCollateralpUSD";

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address payable _proxy,
        TokenState _tokenState,
        string memory _tokenName,
        string memory _tokenSymbol,
        address _owner,
        bytes32 _currencyKey,
        uint _totalSupply,
        address _resolver
    ) public Pynth(_proxy, _tokenState, _tokenName, _tokenSymbol, _owner, _currencyKey, _totalSupply, _resolver) {}

    /* ========== VIEWS ======================= */

    function collateralManager() internal view returns (ICollateralManager) {
        return ICollateralManager(requireAndGetAddress(CONTRACT_COLLATERALMANAGER));
    }

    function etherCollateral() internal view returns (IEtherCollateral) {
        return IEtherCollateral(requireAndGetAddress(CONTRACT_ETH_COLLATERAL));
    }

    function etherCollateralpUSD() internal view returns (IEtherCollateralpUSD) {
        return IEtherCollateralpUSD(requireAndGetAddress(CONTRACT_ETH_COLLATERAL_PUSD));
    }

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = Pynth.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](3);
        newAddresses[0] = CONTRACT_COLLATERALMANAGER;
        newAddresses[1] = CONTRACT_ETH_COLLATERAL;
        newAddresses[2] = CONTRACT_ETH_COLLATERAL_PUSD;
        addresses = combineArrays(existingAddresses, newAddresses);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /**
     * @notice Function that allows multi Collateral to issue a certain number of pynths from an account.
     * @param account Account to issue pynths to
     * @param amount Number of pynths
     */
    function issue(address account, uint amount) external onlyInternalContracts {
        super._internalIssue(account, amount);
    }

    /**
     * @notice Function that allows multi Collateral to burn a certain number of pynths from an account.
     * @param account Account to burn pynths from
     * @param amount Number of pynths
     */
    function burn(address account, uint amount) external onlyInternalContracts {
        super._internalBurn(account, amount);
    }

    /* ========== MODIFIERS ========== */

    // Contracts directly interacting with multiCollateralPynth to issue and burn
    modifier onlyInternalContracts() {
        bool isFeePool = msg.sender == address(feePool());
        bool isExchanger = msg.sender == address(exchanger());
        bool isIssuer = msg.sender == address(issuer());
        bool ipEtherCollateral = msg.sender == address(etherCollateral());
        bool ipEtherCollateralpUSD = msg.sender == address(etherCollateralpUSD());
        bool isMultiCollateral = collateralManager().hasCollateral(msg.sender);

        require(
            isFeePool || isExchanger || isIssuer || ipEtherCollateral || ipEtherCollateralpUSD || isMultiCollateral,
            "Only FeePool, Exchanger, Issuer or MultiCollateral contracts allowed"
        );
        _;
    }
}
