import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View, Pressable, TextInput } from 'react-native';
import WDILCard from './WDILCard';
import { localStorage } from './LocalStorage';
import { useState } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { RootStackParams } from '../App';
import { CardType } from './types/CardType';
import Icon from 'react-native-vector-icons/Feather';

const CardCreationScreen = () => {

    const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();

    const [questionTextInput, setQuestionTextInput] = useState('');

    const handleSavePress = () => {
        //get current state
        const cardsCurrentState : Array<CardType> = JSON.parse(localStorage.getString('cards') ?? '[]');

        //calculate new id
        const newId = Math.max(...cardsCurrentState.map(card => card.id), -1) + 1;

        cardsCurrentState.push({
            id: newId,
            question: questionTextInput.trim()
        });

        //update storage
        localStorage.set('cards', JSON.stringify(cardsCurrentState));

        //navigate to home screen
        navigation.navigate('Home');
    }

    return (

        <View className="flex-1 justify-start bg-[#F5EFB9] py-0 px-3">
            <StatusBar style="auto" />

            <ScrollView className='w-full'>
                <Text className='text-gray-950 py-3 text-lg font-medium'>When did I last...</Text>
                
                <View className='flex flex-row items-center bg-white rounded-md'>
                    <TextInput
                        className='bg-white h-full rounded-l-md px-3 py-2 text-base shrink grow'
                        multiline={true}
                        numberOfLines={1}
                        autoCapitalize='none'
                        onChangeText={(text) => setQuestionTextInput(text)}
                    />
                    <View className='flex flex-row items-center bg-gray-50 rounded-r-md px-3 h-full'>
                        <Text className='text-lg font-medium'>?</Text>
                    </View>
                </View>


                <Pressable className='bg-[#000000] rounded-md mt-4 flex flex-row items-center justify-center px-4 h-10 grow' onTouchStart={handleSavePress}>
                    <Icon name='save' size={20} color={'white'} />
                    <Text className='text-white text-center text-lg font-medium ml-3'>Save</Text>
                </Pressable>
                
            </ScrollView>

        </View>
    );
};

export default CardCreationScreen;