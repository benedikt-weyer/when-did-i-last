import { View, Text, Pressable } from 'react-native'
import React from 'react'
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { RootStackParams } from '../App';
import { localStorage } from './LocalStorage';
import { CardType } from './types/CardType';

type WDILCardProps = {
    id: number,
    question: string,
    timeSinceEvent: string,
}

const WDILCard = ({ id, question = 'passed a value to this prop', timeSinceEvent = 'never' } : WDILCardProps) => {
    const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();

    const handleNowPress = () => {
        //get current state
        const cardsCurrentState : Array<CardType> = JSON.parse(localStorage.getString('cards') ?? '[]');

        const thisCard = cardsCurrentState.find(card => card.id === id);
        if(thisCard){
            thisCard.lastDoneDate = new Date().getTime();
        }

        //update storage
        localStorage.set('cards', JSON.stringify(cardsCurrentState));
    }

    return (
        <Pressable className='bg-white p-3 rounded-md m-2 flex-1 flex-row justify-between' onPress={() => navigation.navigate('CardEdit', {id: id})}>
            <View className='flex shrink grow'>
                <Text className='text-[#111]'>{question}?</Text>
                <View className='bg-gray-200 h-[1px] my-3' />
                <Text className='text-[#111] font-bold '>{timeSinceEvent}</Text>
            </View>
            <View className='flex items-center justify-center ml-4'>
                <Pressable className='bg-gray-100 rounded-md' onPress={handleNowPress}>
                    <Text className='font-bold p-3'>Now</Text>
                </Pressable>
            </View>
        </Pressable>
    )
};

export default WDILCard;