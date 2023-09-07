import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View, Pressable, TextInput } from 'react-native';
import WDILCard from './WDILCard';
import { localStorage } from './LocalStorage';
import { useState } from 'react';
import { CardType } from './types/CardType';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParams } from '../App';

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
		<View className="flex-1 justify-start bg-[#F5EFB9] py-3 px-2">
            <StatusBar style="auto" />

            <ScrollView>
                <Text className='text-gray-950 py-3 text-lg'>When did I last...</Text>
                <TextInput
                    className='bg-white rounded-md p-3'
                    multiline={true}
                    numberOfLines={1}
                    value={questionTextInput}
                    onChangeText={ (text) => setQuestionTextInput(text) }
                />

                <Pressable className='bg-[#82c056] rounded-md mt-4' onPress={handleSavePress}>
                    <Text className='text-white text-center py-3 text-lg'>Save</Text>
                </Pressable>
                
                <Pressable className='border-2 border- border-red-500 rounded-md mt-4' onPress={handleDeletePress}>
                    <Text className='text-red-500 text-center py-3 text-lg'>Delete</Text>
                </Pressable>
                
            </ScrollView>
			
		</View>
    );
};

export default CardEditScreen;