pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./State.sol";
import "./interfaces/ICrossChainState.sol";

// libraries
import "./Math.sol";

/**
 * @title CrossChainState
 * @author @Enitsed
 * @notice This contract saves data of All the networks staking system debt
 */
contract CrossChainState is Owned, State, ICrossChainState {
    using SafeMath for uint;

    uint private _selfId;
    // current network's inbound amount compiled by other networks
    uint private _outboundSumToCurrentNetwork;


    uint private _crossNetworkIssuedDebt;
    uint private _crossNetworkActiveDebt;
    uint private _selfNetworkIssuedDebt;
    uint private _selfNetworkActiveDebt;

    // the total network debt and current network debt percentage

    constructor(
        address _owner,
        address _associatedContract,
        uint _chainId
    ) public Owned(_owner) State(_associatedContract) {
        _selfId = _chainId;
        // _networkIds.push(_chainId);
    }

    // View functions

    function getChainID() external view returns (uint) {
        return _selfId;
    }

    // function getCrossChainCount() external view returns (uint) {
    //     return _networkIds.length;
    // }

    /**
     * @notice returns current network's issued debt
     * @return uint
     */
    function getCurrentNetworkIssuedDebt() external view returns (uint) {
        return _selfNetworkIssuedDebt;
    }

    /**
     * @notice returns total network's issued debt
     * @return uint
     */
    function getTotalNetworkIssuedDebt() external view returns (uint) {
        return _crossNetworkIssuedDebt.add(_selfNetworkIssuedDebt);
    }

    function getCrossNetworkIssuedDebtAll() external view returns (uint) {
        return _crossNetworkIssuedDebt;
    }

    function getCrossNetworkActiveDebtAll() external view returns (uint) {
        return _crossNetworkActiveDebt;
    }

    function getOutboundSumToCurrentNetwork() external view returns (uint) {
        return _outboundSumToCurrentNetwork;
    }

    //************************ Mutative functions *****************************//
    /**
     * @notice add a cross chain network id
     * @param _networkId id of the cross chain network
     */
    // function addNetworkId(uint _networkId) external onlyAssociatedContract {
    //     for (uint i = 0; i < _networkIds.length; ++i) {
    //         if (_networkIds[i] == _networkId) {
    //             return;
    //         }
    //     }
    //     _networkIds.push(_networkId);
    // }

    /**
     * @notice add cross chain networks' issued debts
     * @param _chainIDs uint[]
     */
    function setCrossNetworkIssuedDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts)
        external
        onlyAssociatedContract
    {
        _crossNetworkIssuedDebt = 0;
        for (uint i; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] == _selfId) {
                _selfNetworkIssuedDebt = _amounts[i];
            } else {
                _crossNetworkIssuedDebt = _crossNetworkIssuedDebt.add(_amounts[i]);
            }
        }
    }

    /**
     * @notice add cross chain networks' active debts
     * @param _chainIDs uint[]
     * @param _amounts uint[] debt amounts
     */
    function setCrossNetworkActiveDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts)
        external
        onlyAssociatedContract
    {
        _crossNetworkActiveDebt = 0;
        for (uint i; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] == _selfId) {
                _selfNetworkActiveDebt = _amounts[i];
            } else {
                _crossNetworkActiveDebt = _crossNetworkActiveDebt.add(_amounts[i]);
            }
        }
    }

    /**
     * @notice add all cross chain networks' debts
     * @param _chainIDs uint
     * @param _debts uint
     * @param _activeDebts uint
     * @param _inbound uint sum of other networks' outbound bridged amount to the current network
     */
    function setCrossNetworkDebtsAll(
        uint[] calldata _chainIDs,
        uint[] calldata _debts,
        uint[] calldata _activeDebts,
        uint _inbound
    ) external onlyAssociatedContract {
        _crossNetworkIssuedDebt = 0;
        _crossNetworkActiveDebt = 0;
        for (uint i; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] != _selfId) {
                _crossNetworkIssuedDebt = _crossNetworkIssuedDebt.add(_debts[i]);
                _crossNetworkActiveDebt = _crossNetworkActiveDebt.add(_activeDebts[i]);
            }
        }
        _outboundSumToCurrentNetwork = _inbound;
    }

    /**
     * @notice add current network's issued debt
     * @param _amount uint
     */
    function addIssuedDebt(uint _chainID, uint _amount) external onlyAssociatedContract {
        if (_chainID == _selfId) {
            _selfNetworkIssuedDebt = _selfNetworkIssuedDebt.add(_amount);
        } else {
            _crossNetworkIssuedDebt = _crossNetworkIssuedDebt.add(_amount);
        }
    }

    /**
     * @notice subtract current network's issued debt
     * @param _amount uint
     */
    function subtractIssuedDebt(uint _chainID, uint _amount) external onlyAssociatedContract {
        if (_chainID == _selfId) {
            require(_selfNetworkIssuedDebt >= _amount, "subtracted amount exceeds current network's issued debt");
            _selfNetworkIssuedDebt = _selfNetworkIssuedDebt.sub(_amount);
        } else {
            require(_crossNetworkIssuedDebt >= _amount, "subtracted amount exceeds cross network's issued debt");
            _crossNetworkIssuedDebt = _crossNetworkIssuedDebt.sub(_amount);
        }
    }

    /**
     * @notice sum of other networks' outbound bridged amount to the current network
     * @param _amount uint
     */
    function setOutboundSumToCurrentNetwork(uint _amount) external onlyAssociatedContract {
        _outboundSumToCurrentNetwork = _amount;
    }

    /**
     * @notice initial current network's issued debt only for the first time,
     *          supposed that it hasn't been bridged to any network
     * @param _amount uint
     */
    function setInitialCurrentIssuedDebt(uint _amount) external onlyAssociatedContract {
        // only initial possible
        if (_selfNetworkIssuedDebt == 0) {
            _selfNetworkIssuedDebt = _amount;
        }
    }
}
