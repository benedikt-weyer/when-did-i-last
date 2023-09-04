import { View, Text, Pressable } from 'react-native'
import React from 'react'
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { RootStackParams } from '../App';

type WDILCardProps = {
    question: string,
    timeSinceEvent: string
}

const WDILCard = ({ question = 'passed a value to this prop', timeSinceEvent = 'never' } : WDILCardProps) => {
    const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();

    return (
        <Pressable className='bg-white p-3 rounded-md m-2 flex-1 flex-row justify-between' onPress={() => navigation.navigate('CardEdit')}>
            <View className='flex w-[75%]'>
                <Text className='text-[#111]'>{question}?</Text>
                <View className='bg-gray-200 h-[1px] my-4' />
                <Text className='text-[#111] font-bold '>{timeSinceEvent} ago</Text>
            </View>
            <View className='flex w-[20%] items-center justify-center'>
                <Pressable className='bg-gray-100 rounded-md'>
                    <Text className='font-bold p-3'>Now</Text>
                </Pressable>
            </View>
        </Pressable>
    )
};

export default WDILCard;