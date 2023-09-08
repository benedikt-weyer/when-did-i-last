import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View, Pressable, TextInput } from 'react-native';
import WDILCard from './WDILCard';
import { localStorage } from './LocalStorage';
import { useState } from 'react';
import { CardType } from './types/CardType';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParams } from '../App';
import Icon from 'react-native-vector-icons/Feather';

type Props = NativeStackScreenProps<RootStackParams, 'CardEdit'>

const CardEditScreen = ({ route, navigation } : Props) => {
    const getQuestionFromCard = () => {
        //get current state
        const cardsCurrentState : Array<CardType> = JSON.parse(localStorage.getString('cards') ?? '[]');

        const thisCard = cardsCurrentState.find(card => card.id === route.params.id);
        
        return thisCard?.question ?? '';
    }

    const [questionTextInput, setQuestionTextInput] = useState(getQuestionFromCard());

    const handleSavePress = () => {
        //get current state
        const cardsCurrentState : Array<CardType> = JSON.parse(localStorage.getString('cards') ?? '[]');

        const thisCard = cardsCurrentState.find(card => card.id === route.params.id);
        if(thisCard){
            thisCard.question = questionTextInput.trim();
        }

        //update storage
        localStorage.set('cards', JSON.stringify(cardsCurrentState));

        //navigate to home screen
        navigation.navigate('Home');
    }

    const handleDeletePress = () => {
        //get current state
        const cardsCurrentState : Array<CardType> = JSON.parse(localStorage.getString('cards') ?? '[]');

        //remove card with current id
        const filteredCards = cardsCurrentState.filter(card => card.id !== route.params.id);

        //update storage
        localStorage.set('cards', JSON.stringify(filteredCards));

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
                        value={questionTextInput}
                    />
                    <View className='flex flex-row items-center bg-gray-50 rounded-r-md px-3 h-full'>
                        <Text className='text-lg font-medium'>?</Text>
                    </View>
                </View>

                <View className='flex flex-row justify-between'>
                    <Pressable className='rounded-md mt-4 flex flex-row items-center justify-left px-4 h-10 bg-[#f54848]' onPress={handleDeletePress}>
                        <Icon name='trash' size={20} color={'#fff'} />
                        
                    </Pressable>

                    <Pressable className='bg-[#000000] rounded-md mt-4 flex flex-row items-center justify-center px-4 h-10 grow ml-4' onTouchStart={handleSavePress}>
                        <Icon name='save' size={20} color={'white'} />
                        <Text className='text-white text-center text-lg font-medium ml-3'>Save</Text>
                    </Pressable>
                </View>
                
            </ScrollView>
			
		</View>
    );
};

export default CardEditScreen;